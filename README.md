# Stripe Payment Site

Одностраничный сайт для оплаты через **Stripe Checkout**. Клиент оплачивает
единоразовый платёж **$5** (не подписку). Дальнейший платёж $35 вы
выставляете вручную из Stripe Dashboard — сайт его не создаёт и не списывает
автоматически.

## Структура проекта

```
stripe-payment-site/
├── public/
│   ├── index.html      — страница оплаты
│   ├── success.html    — страница после успешной оплаты
│   └── cancel.html     — страница при отмене оплаты
├── server.js            — Express backend, создаёт Stripe Checkout Session
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## 1. Установка зависимостей

Убедитесь, что установлен Node.js версии 18 или выше. Затем в папке проекта:

```bash
npm install
```

## 2. Добавление Stripe Secret Key

1. Скопируйте `.env.example` в `.env`:

   ```bash
   cp .env.example .env
   ```

2. Откройте [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys)
   и скопируйте **Secret key** (в тестовом режиме он начинается с `sk_test_...`).

3. Впишите его в `.env`:

   ```
   STRIPE_SECRET_KEY=sk_test_ваш_ключ
   PUBLIC_BASE_URL=http://localhost:3000
   ```

`.env` уже добавлен в `.gitignore` — он никогда не попадёт в GitHub.

## 3. Запуск локально

```bash
npm start
```

Сайт будет доступен на [http://localhost:3000](http://localhost:3000).

## 4. Тестирование в Stripe Test Mode

Пока в `.env` стоит `sk_test_...` ключ, Stripe работает в тестовом режиме —
реальные деньги не списываются.

1. Откройте `http://localhost:3000` и нажмите «Оплатить $5».
2. На странице Stripe Checkout используйте тестовую карту:
   - Номер карты: `4242 4242 4242 4242`
   - Любая future-дата срока действия (например, `12/34`)
   - Любой CVC (например, `123`)
   - Любой почтовый индекс
3. После оплаты вы попадёте на `/success.html`.
4. Если нажать «Назад» / отменить оплату на странице Stripe — попадёте на `/cancel.html`.
5. Проверить платёж можно в [Stripe Dashboard → Payments](https://dashboard.stripe.com/test/payments)
   (тестовый режим).

## 5. Деплой на Vercel

1. Загрузите проект в репозиторий GitHub (файл `.env` не попадёт туда благодаря `.gitignore`).
2. Зайдите на [vercel.com](https://vercel.com) → **Add New Project** → выберите репозиторий.
3. Vercel определит Node.js проект автоматически. Framework Preset можно оставить
   «Other».
4. Перед деплоем добавьте Environment Variables (см. пункт 6 ниже).
5. Нажмите **Deploy**.

Vercel запускает `server.js` как serverless-функцию автоматически благодаря
Express-совместимому раннеру Node.js — дополнительная настройка `vercel.json`
не требуется для базового случая. Если Vercel не подхватит сервер
автоматически, добавьте в корень проекта файл `vercel.json`:

```json
{
  "version": 2,
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }]
}
```

## 6. Environment Variables в Vercel

В настройках проекта Vercel → **Settings → Environment Variables** добавьте:

| Ключ | Значение |
|---|---|
| `STRIPE_SECRET_KEY` | Ваш secret key из Stripe (тестовый или боевой) |
| `PUBLIC_BASE_URL` | URL вашего сайта на Vercel, например `https://ваш-проект.vercel.app` |

После добавления переменных сделайте **Redeploy**, чтобы они применились.

## 7. Переход из Test Mode в Live Mode

1. В Stripe Dashboard переключите тумблер вверху страницы с **Test mode** на **Live mode**.
2. Перейдите в [Developers → API keys](https://dashboard.stripe.com/apikeys)
   в режиме Live и скопируйте боевой Secret key (начинается с `sk_live_...`).
3. В Vercel обновите переменную `STRIPE_SECRET_KEY` на боевой ключ.
4. Сделайте Redeploy проекта.
5. Прежде чем принимать реальные платежи, убедитесь, что в Stripe Dashboard
   заполнены данные компании/физлица, банковский счёт для выплат и настройки
   способов оплаты (см. ниже).

## 8. Как получить ссылку и отправлять клиентам

После деплоя Vercel выдаст постоянный URL вида:

```
https://ваш-проект.vercel.app
```

Именно эту ссылку вы отправляете клиенту одним сообщением. Клиент открывает
её → видит страницу оплаты → нажимает «Оплатить $5» → попадает на Stripe
Checkout → оплачивает → возвращается на `/success.html`.

---

## Что нужно сделать в Stripe Dashboard

1. **Способы оплаты.** В [Settings → Payment methods](https://dashboard.stripe.com/settings/payment_methods)
   включите нужные методы оплаты (карты уже включены по умолчанию; Apple
   Pay/Google Pay, локальные методы и т.д. можно добавить там же). Checkout
   Session сама покажет клиенту только доступные для его страны/валюты методы —
   в коде ничего перечислять не нужно.
2. **Выставление второго платежа ($35).** Когда услуга выполнена:
   - Зайдите в [Dashboard → Payments](https://dashboard.stripe.com/payments),
     найдите платёж клиента на $5, откройте карточку клиента (Customer).
   - Так как в Checkout Session включено сохранение способа оплаты
     (`setup_future_usage: off_session`), у клиента в профиле будет сохранённая
     карта — вы можете создать новый **Invoice** или **Payment Link** на $35 и
     либо отправить клиенту для самостоятельной оплаты, либо (если у карты есть
     согласие клиента) списать вручную через сохранённый способ оплаты в разделе
     клиента.
   - Никакой автоматики для этого списания в коде нет — это осознанно, чтобы
     вы полностью контролировали момент и сумму второго платежа.
3. **Проверка выплат (payouts).** В [Settings → Payouts](https://dashboard.stripe.com/settings/payouts)
   убедитесь, что привязан банковский счёт для получения денег.
4. **Активация аккаунта.** Перед переходом в Live Mode Stripe попросит
   заполнить данные о вас/вашем бизнесе — без этого живые платежи принимать
   нельзя.

---

## Важно про безопасность

- `STRIPE_SECRET_KEY` используется **только** на backend (`server.js`) и
  никогда не попадает в HTML/JS фронтенда.
- Данные карт нигде не сохраняются на вашем сервере — весь ввод карты
  происходит на стороне Stripe (Stripe Checkout).
- `.env` исключён из Git через `.gitignore`.
- Checkout Session создаётся в режиме `payment` (одноразовый), а не
  `subscription` — повторного списания $5 или автоматического списания $35
  не происходит.
