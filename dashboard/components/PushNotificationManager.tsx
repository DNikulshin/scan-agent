'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export function PushNotificationManager() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js').then(async registration => {
        console.log('SW registered for push');
        setPermission(Notification.permission);

        // Проверить существующую subscription
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          // Уже подписан
          console.log('Already subscribed');
        }
      });
    }
  }, []);

  const requestPermission = async () => {
    if ('Notification' in window && 'serviceWorker' in navigator) {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        const registration = await navigator.serviceWorker.ready;
        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });

        // Отправить subscription в Supabase
        await supabase.from('push_subscriptions').upsert({
          endpoint: subscription.endpoint,
          p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
          auth: arrayBufferToBase64(subscription.getKey('auth')!),
        });

        console.log('Push subscription saved');
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

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}