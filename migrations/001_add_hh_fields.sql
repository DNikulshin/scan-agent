-- Добавляет поля employer и city для вакансий HH.ru
ALTER TABLE orders ADD COLUMN IF NOT EXISTS employer TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS city TEXT;
