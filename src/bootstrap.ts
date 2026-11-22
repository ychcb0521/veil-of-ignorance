import './index.css';
import { prepareLoginStorage } from './lib/loginStorage';
import { notifyPersistedStateHydrated } from './lib/persistedStateStorage';
import { isTradeHistoryKey, prepareTradeHistory } from './lib/tradeHistoryStorage';

function showRetry(message: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.textContent = message;
  const retry = document.createElement('button');
  retry.textContent = '重试';
  retry.onclick = () => location.reload();
  root.append(retry);
}

void prepareTradeHistory().then(() => {
  window.addEventListener('storage', event => {
    if (event.storageArea === localStorage && isTradeHistoryKey(event.key)) notifyPersistedStateHydrated(event.key);
  });
  prepareLoginStorage();
  void import('./main').catch(() => showRetry('应用加载失败，请重试。'));
}, () => showRetry('本机交易历史暂时无法读取。请保留本站数据并重试。'));
