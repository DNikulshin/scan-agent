'use client';

import { useEffect, useState } from 'react';

export function PushNotificationManager() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js').then(registration => {
        console.log('SW registered for push');
        setPermission(Notification.permission);
      });
    }
  }, []);

  const requestPermission = async () => {
    if ('Notification' in window) {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        // Здесь можно отправить subscription на сервер
        console.log('Push permission granted');
      }
    }
  };

  if (permission === 'default') {
    return (
      <button
        onClick={requestPermission}
        className="fixed bottom-4 right-4 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-50"
      >
        🔔 Включить уведомления
      </button>
    );
  }

  return null;
}