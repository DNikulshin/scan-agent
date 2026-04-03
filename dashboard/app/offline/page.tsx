export default function Offline() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">🔌 Оффлайн</h1>
        <p className="text-gray-400 mb-8">Нет подключения к интернету. Проверьте соединение и попробуйте снова.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium"
        >
          Обновить
        </button>
      </div>
    </div>
  );
}