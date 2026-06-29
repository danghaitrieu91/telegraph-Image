export const runtime = 'edge';
import { getRequestContext } from '@cloudflare/next-on-pages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400', // 24 hours
  'Content-Type': 'application/json'
};

export async function GET(request, { params }) {
  const { name } = params
  let { env, cf, ctx } = getRequestContext();

  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') ||  request.socket.remoteAddress;
  const clientIp = ip ? ip.split(',')[0].trim() : 'IP not found';
  const Referer = request.headers.get('Referer') || "Referer";

  const req_url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', // 24 giờ
      },
    });
  }

  // 1. Kiểm tra điều kiện bỏ qua DB (giống nguyên bản)
  const isBypass = (Referer == req_url.origin + "/admin" || Referer == req_url.origin + "/list" || Referer == req_url.origin + "/") || !env.IMG;

  if (isBypass) {
    try {
      const res = await fetch(`https://telegra.ph/file/${name}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })
      return res
    } catch (error) {
      return Response.json({
        status: 500,
        message: ` ${error.message}`,
        success: false
      }, {
        status: 500,
        headers: corsHeaders,
      })
    }
  }

  // 2. Sử dụng Cache API tại Edge cho các GET request hợp lệ (Chiến thuật 2)
  const cache = caches.default;
  const cacheKey = new Request(req_url.toString(), {
    method: 'GET'
  });

  if (request.method === 'GET') {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  try {
    const res = await fetch(`https://telegra.ph/file/${name}`, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })

    const nowTime = await get_nowTime()
    // Đã loại bỏ hoàn toàn insertTgImgLog và update total (Chiến thuật 3 - Option A)
    const rating = await getRating(env.IMG, `/file/${name}`);
    let finalResponse;

    if (rating) {
      if (rating.rating == 3) {
        finalResponse = new Response(null, {
          status: 302,
          headers: {
            'Location': `${req_url.origin}/img/blocked.png`,
            'Cache-Control': 'public, max-age=86400'
          }
        });
      } else {
        finalResponse = res.clone();
      }
    } else {
      if (env.PROXYALLIMG) {
        try {
          const rating_index = await getModerateContentRating(env, `/file/${name}`)
          const nowTime = await get_nowTime()
          await insertImgInfo(env.IMG, `/file/${name}`, Referer, clientIp, rating_index, nowTime);
     
          if (rating_index == 3) {
            finalResponse = new Response(null, {
              status: 302,
              headers: {
                'Location': `${req_url.origin}/img/blocked.png`,
                'Cache-Control': 'public, max-age=86400'
              }
            });
          } else {
            finalResponse = res.clone();
          }
        } catch (error) {
          finalResponse = res.clone();
        }
      } else {
        finalResponse = new Response(null, {
          status: 302,
          headers: {
            'Location': `https://telegra.ph/file/${name}`,
            'Cache-Control': 'public, max-age=86400'
          }
        });
      }
    }

    // 3. Lưu response vào Cloudflare Cache (Chiến thuật 2)
    if (request.method === 'GET' && (finalResponse.status === 200 || finalResponse.status === 302)) {
      let responseToCache;
      if (!finalResponse.headers.has('Cache-Control')) {
        let newHeaders = new Headers(finalResponse.headers);
        newHeaders.set('Cache-Control', 'public, max-age=86400'); // Cache trong 1 ngày
        responseToCache = new Response(finalResponse.clone().body, {
          status: finalResponse.status,
          statusText: finalResponse.statusText,
          headers: newHeaders
        });
      } else {
        responseToCache = finalResponse.clone();
      }
      ctx.waitUntil(cache.put(cacheKey, responseToCache));
    }

    return finalResponse;

  } catch (error) {
    return Response.json({
      status: 500,
      message: ` ${error.message}`,
      success: false
    }, {
      status: 500,
      headers: corsHeaders,
    })
  }
}







// 插入 tgimglog 记录
async function insertTgImgLog(DB, url, referer, ip, time) {
  const iImglog = await DB.prepare('INSERT INTO tgimglog (url, referer, ip, time) VALUES (?, ?, ?, ?)')
    .bind(url, referer, ip, time)
    .run();
}
// 插入 imginfo 记录
async function insertImgInfo(DB, url, referer, ip, rating,  time) {
  try {
    const instdata = await DB.prepare(
      `INSERT INTO imginfo (url, referer, ip, rating, total, time)
           VALUES ('${url}', '${referer}', '${ip}', ${rating}, 1, '${time}')`
    ).run()
  } catch (error) {

  };




}

// 从数据库获取鉴黄信息
async function getRating(DB, url) {
  const ps = DB.prepare(`SELECT rating FROM imginfo WHERE url='${url}'`);
  const result = await ps.first();
  return result;
}

// 调用 ModerateContent API 鉴黄
async function getModerateContentRating(env, url) {
  try {
    const apikey = env.ModerateContentApiKey 
    const ModerateContentUrl = apikey ? `https://api.moderatecontent.com/moderate/?key=${apikey}&` : ""
    const ratingApi = env.RATINGAPI ? `${env.RATINGAPI}?` : ModerateContentUrl;
    console.log(`${ratingApi}url=https://telegra.ph${url}`);
    if (ratingApi) {
      const res = await fetch(`${ratingApi}url=https://telegra.ph${url}`);
      const data = await res.json();
      const rating_index = data.hasOwnProperty('rating_index') ? data.rating_index : -1;

      return rating_index;
    } else {
      return 0
    }


  } catch (error) {
    console.log("error");
    return -1
  }
}


async function get_nowTime() {
  const options = {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  };
  const timedata = new Date();
  const formattedDate = new Intl.DateTimeFormat('zh-CN', options).format(timedata);

  return formattedDate

}