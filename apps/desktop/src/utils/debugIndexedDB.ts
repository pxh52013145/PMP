/**
 * IndexedDB 调试工具
 * 用于检查和调试音乐库数据库
 */

export async function debugIndexedDB() {
  console.log('=== IndexedDB Debug Info ===');

  try {
    // 打开数据库
    const request = indexedDB.open('MusicLibrary', 1);

    request.onsuccess = () => {
      const db = request.result;
      console.log('Database opened successfully');
      console.log('Database name:', db.name);
      console.log('Database version:', db.version);
      console.log('Object stores:', Array.from(db.objectStoreNames));

      // 读取所有轨道
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const tracks = getAllRequest.result;
        console.log('Total tracks in database:', tracks.length);
        if (tracks.length > 0) {
          console.log('First track:', tracks[0]);
        }
      };

      getAllRequest.onerror = () => {
        console.error('Failed to get tracks:', getAllRequest.error);
      };
    };

    request.onerror = () => {
      console.error('Failed to open database:', request.error);
    };
  } catch (error) {
    console.error('Error:', error);
  }
}

export async function clearIndexedDB() {
  console.log('Clearing IndexedDB...');
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('MusicLibrary');
    request.onsuccess = () => {
      console.log('Database cleared successfully');
      resolve();
    };
    request.onerror = () => {
      console.error('Failed to clear database:', request.error);
      reject(request.error);
    };
  });
}

// 在浏览器控制台中可用
if (typeof window !== 'undefined') {
  const win = window as unknown as Window & {
    debugIndexedDB?: typeof debugIndexedDB;
    clearIndexedDB?: typeof clearIndexedDB;
  };
  win.debugIndexedDB = debugIndexedDB;
  win.clearIndexedDB = clearIndexedDB;
  console.log('Debug tools available: debugIndexedDB(), clearIndexedDB()');
}
