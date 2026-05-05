# Dev-сабдомены через Caddy

Любой dev-порт в codeserver-контейнере выводится наружу через сабдомен с Authelia за один шаг. Паттерн в `/opt/home-codespaces/Caddyfile`:

```caddy
(devport) {
    import authelia
    reverse_proxy codeserver:{args[0]}
}

studio.nikulshin-dev.online   { import devport 5555 }   # Prisma Studio
# nest-api.nikulshin-dev.online { import devport 4000 } # пример: NestJS
# react-dev.nikulshin-dev.online { import devport 5173 } # пример: Vite
```

## Добавить новый сабдомен (через webssh на хосте)

```bash
sudo tee -a /opt/home-codespaces/Caddyfile > /dev/null <<'EOF'

myapp.nikulshin-dev.online { import devport 8000 }
EOF
sudo docker exec home-codespaces-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

## Биндить процесс на 0.0.0.0

Caddy в соседнем контейнере не видит `127.0.0.1`:

- Prisma Studio: `npx prisma studio --hostname 0.0.0.0 --port 5555 --browser none`
- Next.js dev: `next dev -H 0.0.0.0 -p 3000`
- NestJS: `await app.listen(4000, '0.0.0.0')`
- Vite: `vite --host 0.0.0.0`

## Прочее

- DNS — wildcard `*.nikulshin-dev.online` уже настроен.
- Сертификаты — Caddy через HTTP-01 автоматом.
- Wildcard-cert (`*.dev.nikulshin-dev.online`) потребует пересборки Caddy с `caddy-dns/cloudflare` + CF API-token (отдельная задача).
