# DeRon Market Deliveries

A mobile-first digital marketplace for groceries, foodstuffs and everyday essentials, initially serving university students and surrounding residents around Kirinyaga University.

## Product model

DeRon uses a marketplace model:

- Customers browse markets and shop for products.
- Market owners manage their market profile, products, categories, availability and orders.
- Riders handle delivery and order status updates.
- Administrators manage markets, customers, riders, products, orders, payments, delivery fees and platform settings.

The customer experience is positioned around:

**Shopping made easier. Delivered by DeRon.**

Fresh groceries, foodstuffs and everyday essentials without leaving your room.

## Existing application structure

The existing application architecture is intentionally retained:

- Frontend: static HTML, CSS and JavaScript customer, market-owner, rider and admin portals.
- Backend: Node.js and Express REST API.
- Database: PostgreSQL.
- Payments: M-Pesa integration and supported cash-payment flow.
- Delivery: rider assignment, delivery fees, status updates and tracking.
- Authentication: customer, market-owner, rider and administrator access.

## Compatibility note

The first marketplace conversion keeps the existing database and API identifiers so existing integrations are not broken:

- The internal `restaurants` table and `/api/restaurants` endpoints represent markets.
- The internal `restaurant` account role represents a market owner.
- The internal `foods` records represent market products.
- Existing `restaurant_id` fields link products, orders and categories to their market.

These are compatibility names, not the customer-facing business terminology. A database-wide rename is deliberately avoided until a separately tested migration can update every foreign key, query, report, API consumer and deployed database safely.

## Core shopping categories

The marketplace is intended to support:

- Vegetables and fruits
- Cereals and grains
- Eggs and dairy
- Meat and other fresh foods
- Toiletries and personal-care products
- Household essentials

## Local development

Backend setup:

```bash
cd Backend
npm install
npm start
```

Configure environment variables using `Backend/.env.example`. Do not commit production credentials or payment secrets.

## Deployment

The repository includes `render.yaml` for Render deployment. Verify the configured service branch, environment variables and database before deploying marketplace changes.
