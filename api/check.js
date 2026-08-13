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
    url: 'https://shopee.tw/OSMO-POCKET-4P%E9%9B%BB%E5%BD%B1%E7%B4%9A%E6%89%8B%E6%8C%81%E6%94%9D%E5%BD%B1%E6%A9%9F%E7%9B%B8%E6%A9%9F-%EF%BD%9C%E5%BB%A3%E8%A7%92%E4%B8%AD%E7%84%A6%E9%9B%99%E9%8F%A1%E9%A0%AD-i.918848222.50510170277',
    type: 'shopee'
  }
];

// 發送 LINE 推播訊息
async function sendLineNotification(message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) {
    console.error('尚未設定 LINE 環境變數！');
    return;
  }

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
    console.error('LINE 訊息發送失敗：', err.response ? err.response.data : err.message);
  }
}

module.exports = async (req, res) => {
  const availableStores = [];

  for (const store of STORES) {
    try {
      const response = await axios.get(store.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 9000
      });

      const html = response.data;
      let inStock = false;

      // 針對各平台購買按鈕/關鍵字做邏輯判讀
      if (store.type === 'yahoo') {
        if (!html.includes('已售完') && !html.includes('貨到通知我')) {
          inStock = true;
        }
      } else if (store.type === 'pchome') {
        if (!html.includes('有貨通知我') && html.includes('加入購物車')) {
          inStock = true;
        }
      } else if (store.type === 'dji') {
        if (html.includes('立即購買') || html.includes('加入購物車') || html.includes('In Stock')) {
          inStock = true;
        }
      } else if (store.type === 'shopee') {
        if (!html.includes('sold_out') && !html.includes('已售完')) {
          inStock = true;
        }
      }

      if (inStock) {
        availableStores.push(store);
      }
    } catch (error) {
      console.log(`[檢查異常/暫時無法存取] ${store.name}: ${error.message}`);
    }
  }

  // 只要有任一平台有貨，發送 LINE 提醒
  if (availableStores.length > 0) {
    let msg = `🚨【DJI Pocket 4 Vlog套裝 庫存通知】🚨\n\n發現有現貨可以購買了！\n`;
    availableStores.forEach((item) => {
      msg += `\n📍 ${item.name}\n🔗 ${item.url}\n`;
    });
    await sendLineNotification(msg);
  }

  return res.status(200).json({
    status: 'success',
    checkedStores: STORES.length,
    inStockCount: availableStores.length,
    timestamp: new Date().toISOString()
  });
};
