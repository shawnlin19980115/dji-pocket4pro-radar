const axios = require('axios');

// 監控店家清單
const STORES = [
  {
    name: 'DJI 官網 (Vlog套裝)',
    url: 'https://store.dji.com/tw/product/osmo-pocket-4p-vlog-combo?from=site-nav&vid=241311&set_region=TW',
    type: 'dji'
  },
  {
    name: 'Yahoo!購物中心',
    url: 'https://tw.buy.yahoo.com/gdsale/DJI-OSMO-POCKET-4P-VLOG%E5%A5%97%E8%A3%9D-%E9%9B%BB%E5%BD%B1%E7%B4%9A%E6%89%8B%E6%8C%81%E6%94%9D%E5%BD%B1%E6%A9%9F%E7%9B%B8%E6%A9%9F-%E5%BB%A3%E8%A7%92%E4%B8%AD%E7%84%A6%E9%9B%99%E9%8F%A1%E9%A0%AD-12147914.html',
    type: 'yahoo'
  },
  {
    name: 'PChome 24h購物',
    url: 'https://24h.pchome.com.tw/prod/DGCF6H-A900K53VH',
    type: 'pchome'
  },
  {
    name: '蝦皮商城 DJI 直營',
    url: 'https://shopee.tw/api/v4/item/get?itemid=50510170277&shopid=918848222',
    type: 'shopee_api' // 蝦皮改用官方公開 API 抓取庫存數字，最精準！
  }
];

// 發送 LINE 推播訊息
async function sendLineNotification(message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) return;

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: userId,
        messages: [{ type: 'text', text: message }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      }
    );
  } catch (err) {
    console.error('LINE 發送失敗：', err.message);
  }
}

module.exports = async (req, res) => {
  const storeResults = [];
  const availableStores = [];

  for (const store of STORES) {
    let inStock = false;

    try {
      if (store.type === 'shopee_api') {
        // 蝦皮直接打商品 API 查 stock 數量
        const resShopee = await axios.get(store.url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000
        });
        const stock = resShopee.data?.data?.stock || 0;
        if (stock > 0) inStock = true;
      } else {
        const response = await axios.get(store.url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          timeout: 8000
        });

        const html = response.data;

        if (store.type === 'yahoo') {
          // Yahoo：不可以出現售完/無庫存字眼，且必須有購物車按鈕
          if (!html.includes('已售完') && !html.includes('貨到通知我') && html.includes('AddCart')) {
            inStock = true;
          }
        } else if (store.type === 'pchome') {
          // PChome：不可有「有貨通知我」
          if (!html.includes('有貨通知我') && html.includes('加入購物車')) {
            inStock = true;
          }
        } else if (store.type === 'dji') {
          // DJI 官網：精確判斷「缺貨/OutOfStock」與「加入購物車」
          const isOutOfStock = html.includes('暫無存貨') || html.includes('缺貨') || html.includes('out of stock');
          const hasBuyBtn = html.includes('btn-buy') || html.includes('加入購物車') || html.includes('Buy Now');
          if (!isOutOfStock && hasBuyBtn) {
            inStock = true;
          }
        }
      }
    } catch (error) {
      console.log(`[檢查異常] ${store.name}: ${error.message}`);
    }

    if (inStock) {
      availableStores.push(store);
    }

    storeResults.push({
      name: store.name,
      url: store.type === 'shopee_api' ? 'https://shopee.tw/OSMO-POCKET-4P%E9%9B%BB%E5%BD%B1%E7%B4%9A%E6%89%8B%E6%8C%81%E6%94%9D%E5%BD%B1%E6%A9%9F%E7%9B%B8%E6%A9%9F-%EF%BD%9C%E5%BB%A3%E8%A7%92%E4%B8%AD%E7%84%A6%E9%9B%99%E9%8F%A1%E9%A0%AD-i.918848222.50510170277' : store.url,
      inStock: inStock
    });
  }

  // 只在真正的「有貨賣場數 > 0」時發送 LINE
  if (availableStores.length > 0) {
    let msg = `🚨【DJI Pocket 4 Vlog套裝 現貨到補通知】🚨\n\n發現以下平台已有現貨：\n`;
    availableStores.forEach((item) => {
      const targetUrl = item.type === 'shopee_api' ? 'https://shopee.tw/OSMO-POCKET-4P%E9%9B%BB%E5%BD%B1%E7%B4%9A%E6%89%8B%E6%8C%81%E6%94%9D%E5%BD%B1%E6%A9%9F%E7%9B%B8%E6%A9%9F-%EF%BD%9C%E5%BB%A3%E8%A7%92%E4%B8%AD%E7%84%A6%E9%9B%99%E9%8F%A1%E9%A0%AD-i.918848222.50510170277' : item.url;
      msg += `\n📍 ${item.name}\n🔗 ${targetUrl}\n`;
    });
    await sendLineNotification(msg);
  }

  return res.status(200).json({
    status: 'success',
    checkedStores: STORES.length,
    inStockCount: availableStores.length,
    stores: storeResults,
    timestamp: new Date().toISOString()
  });
};
