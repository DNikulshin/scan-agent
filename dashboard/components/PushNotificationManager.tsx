'use client';

import { useEffect, useState } from 'react';

export function PushNotificationManager() {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    navigator.serviceWorker.register('/sw.js').then(async registration => {
      const currentPermission = Notification.permission;
      setPermission(currentPermission);

      if (currentPermission === 'granted') {
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          // Подписка есть в браузере — синхронизируем с БД
          await saveSubscription(existing);
        } else {
          // Разрешение есть, подписки нет — создаём автоматически
          await subscribe(registration);
        }
      }
    });
  }, []);

  const requestPermission = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== 'granted') return;
    const registration = await navigator.serviceWorker.ready;
    await subscribe(registration);
  };

  if (permission !== 'default') return null;

  return (
    <button
      onClick={requestPermission}
      className="fixed bottom-4 right-4 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-50"
    >
      🔔 Включить уведомления
    </button>
  );
}

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch('/api/vapid-public-key');
  if (!res.ok) throw new Error('Failed to fetch VAPID public key');
  const { key } = await res.json();
  return key;
}

async function subscribe(registration: ServiceWorkerRegistration) {
  try {
    const vapidPublicKey = await getVapidPublicKey();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
    await saveSubscription(subscription);
  } catch (err) {
    console.error('Push subscribe error:', err);
  }
}

async function saveSubscription(subscription: PushSubscription) {
  try {
    const res = await fetch('/api/push-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
        auth: arrayBufferToBase64(subscription.getKey('auth')!),
      }),
    });
    if (!res.ok) console.error('Error saving push subscription:', await res.text());
  } catch (err) {
    console.error('Exception saving push subscription:', err);
  }
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
