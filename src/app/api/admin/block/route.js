
import { getRequestContext } from '@cloudflare/next-on-pages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400', // 24 hours
  'Content-Type': 'application/json'
};

export const runtime = 'edge';

export async function PUT(request) {
  let { rating, name } = await request.json()
  // 获取客户端的IP地址
  const { env, cf, ctx } = getRequestContext();
  // console.log(dd);


  try {
    const setData = await env.IMG.prepare(`UPDATE imginfo SET rating = ${rating} WHERE url='${name}'`).run()
    
    // Xóa cache cũ của ảnh tại Edge (Chiến thuật 2)
    try {
      const reqUrl = new URL(request.url);
      const imageUrl = `${reqUrl.origin}${name}`;
      const cache = caches.default;
      const cacheKey = new Request(imageUrl, { method: 'GET' });
      await cache.delete(cacheKey);
    } catch (cacheError) {
      console.error("Lỗi xóa cache:", cacheError);
    }

    return Response.json({
      "code": 200,
      "success": true,
      "message": setData.success,
    });

  } catch (error) {
    return Response.json({
      "code": 500,
      "success": false,
      "message": error.message,
    }, {
      status: 500,
      headers: corsHeaders,
    })
  }

}




