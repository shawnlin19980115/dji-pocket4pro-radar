const axios = require('axios');
const { kv } = require('@vercel/kv');

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
    type: 'shopee_api'
  },
  {
    name: 'momo購物網',
    url: 'https://www.momoshop.com.tw/product/15612111',
    type: 'momo'
  }
];

async function sendLineNotification(message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) return;

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: userId, messages: [{ type: 'text', text: message }] },
      { headers: { 'Content-Type': 'application/json', Authorization: Bearer ${token} } }
    );
  } catch (err) {
    console.error('LINE 發送失敗：', err.message);
  }
}

async function checkSingleStore(store) {
  let inStock = false;
  try {
    if (store.type === 'shopee_api') {
      const res = await axios.get(store.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 3500 });
      if ((res.data?.data?.stock || 0) > 0) inStock = true;
    } else {
      const res = await axios.get(store.url, {
        headers: {
          'User-Agent': store.type === 'momo' 
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': store.type === 'momo' ? 'https://m.momoshop.com.tw/' : undefined
        },
        timeout: 3500
      });
      const html = res.data || '';
      if (store.type === 'yahoo') {
        if (!html.includes('已售完') && !html.includes('貨到通知我') && html.includes('AddCart')) inStock = true;
      } else if (store.type === 'pchome') {
        if (!html.includes('有貨通知我') && html.includes('加入購物車')) inStock = true;
      } else if (store.type === 'dji') {
        if (!html.includes('暫無存貨') && !html.includes('缺貨') && (html.includes('btn-buy') || html.includes('加入購物車'))) inStock = true;
      } else if (store.type === 'momo') {
        if (!html.includes('售完補貨中') && !html.includes('補貨中') && (html.includes('直接購買') || html.includes('放入購物車'))) inStock = true;
      }
    }
  } catch (err) {
    console.log(`[${store.name}] 抓取跳過: ${err.message}`);
  }

  return {
    name: store.name,
    url: store.type === 'shopee_api' ? 'https://shopee.tw/OSMO-POCKET-4P%E9%9B%BB%E5%BD%B1%E7%B4%9A%E6%89%8B%E6%8C%81%E6%94%9D%E5%BD%B1%E6%A9%9F%E7%9B%B8%E6%A9%9F-%EF%BD%9C%E5%BB%A3%E8%A7%92%E4%B8%AD%E7%84%A6%E9%9B%99%E9%8F%A1%E9%A0%AD-i.918848222.50510170277' : store.url,
    inStock: inStock
  };
}

module.exports = async (req, res) => {
  // 💡 設定 Vercel 節點快取 30 秒，避免請求太頻繁被平台擋 IP
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=59');

  const promises = STORES.map(store => checkSingleStore(store));
  const results = await Promise.allSettled(promises);
  const storeResults = results.map(r => r.value);
  const availableStores = storeResults.filter(s => s && s.inStock);

  // 💡 Redis 防洗版邏輯
  if (availableStores.length > 0) {
    try {
      const hasNotified = await kv.get('pocket4_notified');
      if (!hasNotified) {
        let msg = `🚨【DJI Pocket 4 Vlog套裝 現貨到補通知】🚨\n\n發現以下平台已有現貨：\n`;
        availableStores.forEach(item => { msg += `\n📍 ${item.name}\n🔗 ${item.url}\n`; });
        await sendLineNotification(msg);
        await kv.set('pocket4_notified', 'true', { ex: 1800 }); // 鎖定 30 分鐘
      }
    } catch (e) { console.error('KV 錯誤:', e.message); }
  } else {
    try { await kv.del('pocket4_notified'); } catch (e) {} // 缺貨時自動重置
  }

  const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  return res.status(200).json({
    status: 'success',
    checkedStores: STORES.length,
    inStockCount: availableStores.length,
    stores: storeResults,
    timestamp: new Date().toISOString(),
    lastUpdated: nowStr
  });
};
const axios = require('axios');

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
    type: 'shopee_api'
  },
  {
    name: 'momo購物網',
    url: 'https://www.momoshop.com.tw/product/15612111',
    type: 'momo'
  }
];

// 單一店家庫存檢查函式 (加入硬性 3.5 秒 Timeout)
async function checkSingleStore(store) {
  let inStock = false;
  try {
    if (store.type === 'shopee_api') {
      const res = await axios.get(store.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 3500
      });
      const stock = res.data?.data?.stock || 0;
      if (stock > 0) inStock = true;
    } else {
      const res = await axios.get(store.url, {
        headers: {
          'User-Agent': store.type === 'momo' 
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': store.type === 'momo' ? 'https://m.momoshop.com.tw/' : undefined
        },
        timeout: 3500
      });

      const html = res.data || '';

      if (store.type === 'yahoo') {
        if (!html.includes('已售完') && !html.includes('貨到通知我') && html.includes('AddCart')) inStock = true;
      } else if (store.type === 'pchome') {
        if (!html.includes('有貨通知我') && html.includes('加入購物車')) inStock = true;
      } else if (store.type === 'dji') {
        const isOutOfStock = html.includes('暫無存貨') || html.includes('缺貨') || html.includes('out of stock');
        const hasBuyBtn = html.includes('btn-buy') || html.includes('加入購物車') || html.includes('Buy Now');
        if (!isOutOfStock && hasBuyBtn) inStock = true;
      } else if (store.type === 'momo') {
        const isSoldOut = html.includes('售完補貨中') || html.includes('補貨中') || html.includes('商品已售完');
        const hasBuy = html.includes('直接購買') || html.includes('放入購物車') || html.includes('立即結帳');
        if (!isSoldOut && hasBuy) inStock = true;
      }
    }
  } catch (err) {
    console.log(`[${store.name}] 抓取跳過或失敗: ${err.message}`);
  }

  return {
    name: store.name,
    url: store.type === 'shopee_api' 
      ? 'https://shopee.tw/OSMO-POCKET-4P%E9%9B%BB%E5%BD%B1%E7%B4%9A%E6%89%8B%E6%8C%81%E6%94%9D%E5%BD%B1%E6%A9%9F%E7%9B%B8%E6%A9%9F-%EF%BD%9C%E5%BB%A3%E8%A7%92%E4%B8%AD%E7%84%A6%E9%9B%99%E9%8F%A1%E9%A0%AD-i.918848222.50510170277' 
      : store.url,
    inStock: inStock
  };
}

module.exports = async (req, res) => {
  // 並行發送所有請求，大幅提升速度
  const promises = STORES.map(store => checkSingleStore(store));
  const results = await Promise.allSettled(promises);

  const storeResults = results.map(r => r.value);
  const availableStores = storeResults.filter(s => s && s.inStock);

  // 回傳完整 Response (包含多個時間欄位，對應前端命名)
  const now = new Date();
  const formattedTime = now.toLocaleTimeString('zh-TW', { hour12: false });

  return res.status(200).json({
    status: 'success',
    checkedStores: STORES.length,
    inStockCount: availableStores.length,
    stores: storeResults,
    timestamp: now.toISOString(),
    lastUpdated: formattedTime, // 提供格式化時間
    time: formattedTime
  });
};
