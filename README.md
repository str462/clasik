# Stripe Payment Site — $5 now, $35 later

Этот вариант построен именно под сценарий:

1. Клиент оплачивает **фиксированные $5**.
2. Stripe создаёт нормальный **Customer**, а не Guest.
3. Карта сохраняется у Customer для будущего merchant-initiated off-session платежа.
4. Webhook автоматически делает сохранённую карту **default payment method** Customer.
5. После выполнения услуги вы открываете `/admin.html`, вводите Customer ID + ADMIN_TOKEN + уникальный reference и нажимаете **«Списать $35»**.
6. Backend сам создаёт `PaymentIntent` на фиксированные **$35** с `off_session: true` и `confirm: true`.

Это **не Subscription**. Второй платеж — отдельное одноразовое списание.

## Что изменилось

- Убран изменяемый через `?amount=` initial amount. Теперь $5 фиксированы на backend.
- Создаётся Stripe Customer до Checkout.
- `setup_future_usage: off_session` сохраняет PaymentMethod.
- Добавлен Stripe webhook `/api/stripe-webhook`.
- Webhook назначает сохранённую карту `invoice_settings.default_payment_method`.
- Добавлен защищённый `/api/charge-followup` для автоматического $35.
- Добавлена простая админ-страница `/admin.html`.
- Добавлена защита от повторного списания через уникальный `reference` + Stripe idempotency key.
- Добавлена обработка случая `authentication_required`.
- Добавлен `vercel.json` для явного serverless deployment.

## Важно про согласие клиента

Если вы планируете после выполнения услуги списывать с сохранённой карты отдельные $35, на странице оплаты прямо указано, что способ оплаты может быть использован для последующего списания $35. Используйте эту механику только в рамках условий, на которые клиент действительно согласился, и требований Stripe/банка.

## 1. Установка

```bash
npm install
```

## 2. Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
ADMIN_TOKEN=длинный-случайный-секрет
PUBLIC_BASE_URL=http://localhost:3000
INITIAL_AMOUNT_USD=5
FOLLOWUP_AMOUNT_USD=35
```

Не отправляйте `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` или `ADMIN_TOKEN` в чат и не вставляйте их в HTML.

## 3. Webhook — ОБЯЗАТЕЛЬНО

В Stripe Dashboard откройте **Developers → Webhooks** и создайте endpoint:

```text
https://ВАШ-DOMEN.vercel.app/api/stripe-webhook
```

Минимально подпишитесь на:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`

Stripe покажет signing secret вида `whsec_...`. Его положите в `STRIPE_WEBHOOK_SECRET`.

### Локальное тестирование

Если установлен Stripe CLI:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

CLI выдаст временный `whsec_...` — используйте его локально.

## 4. Тест $5

Запустите:

```bash
npm start
```

Откройте:

```text
http://localhost:3000
```

Для Stripe Test Mode можно использовать стандартную успешную тестовую карту:

```text
4242 4242 4242 4242
```

После оплаты на success page появится **Customer ID**. В Dashboard этот клиент также должен быть виден как обычный Customer, с сохранённым PaymentMethod.

## 5. Тест автоматического $35

Откройте:

```text
http://localhost:3000/admin.html
```

Введите:

- `ADMIN_TOKEN` из `.env`;
- `Customer ID`, который получил клиент после $5;
- уникальный `Service reference`, например `order-1042`.

Нажмите **«Списать $35»**.

Backend НЕ принимает сумму из формы. Всегда используется `FOLLOWUP_AMOUNT_USD=35`.

После успешного списания в Stripe появится новый PaymentIntent на $35, связанный с Customer.

## 6. Vercel

Добавьте в Vercel Environment Variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ADMIN_TOKEN`
- `PUBLIC_BASE_URL`
- `INITIAL_AMOUNT_USD=5`
- `FOLLOWUP_AMOUNT_USD=35`

После изменения env сделайте Redeploy.

`PUBLIC_BASE_URL` должен быть реальным URL проекта, например:

```text
https://your-project.vercel.app
```

## 7. Как это будет выглядеть в Stripe

После первого платежа:

```text
Customer
  ├─ PaymentMethod (сохранённая карта)
  ├─ PaymentIntent $5
  └─ default payment method = сохранённая карта
```

После выполнения услуги:

```text
Customer
  ├─ PaymentIntent $5
  └─ PaymentIntent $35 (off-session)
```

Подписки для этого сценария нет.

## 8. Если Stripe требует 3-D Secure

Некоторые карты/банки могут потребовать дополнительную аутентификацию. Тогда полностью автоматическое off-session списание невозможно для конкретной транзакции. Backend вернёт `authentication_required` вместо того, чтобы ошибочно считать платёж успешным.

В таком случае клиент должен будет подтвердить платёж присутствуя в Checkout/другом подходящем Stripe flow.

## 9. Безопасность

- Secret key только на backend.
- Webhook проверяется через Stripe signature.
- Admin endpoint защищён отдельным `ADMIN_TOKEN`.
- Сумма $35 задаётся только на сервере.
- `reference` используется для idempotency, чтобы двойной клик не создал повторный платёж.
- Номера карт сайт не получает и не хранит.

## 10. Product / Price ID

Для этого сценария Product/Price ID не обязателен. Первый $5 и последующий $35 — одноразовые PaymentIntent'ы. Если позже понадобится красивый каталог Stripe, Invoice или фиксированный Price для $35, его можно добавить отдельно, не меняя основную модель сохранённой карты.
