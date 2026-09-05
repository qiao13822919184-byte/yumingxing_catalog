# Yumingxing independent product catalogue

- This project runs locally or on the user's own server. Never use OpenAI Sites, Cloudflare bindings, or ChatGPT authentication.
- All project source belongs in this directory and the user's GitHub repository `qiao13822919184-byte/yumingxing_catalog`.
- React + Vite frontend; Node.js 24 HTTP API; SQLite and uploaded media remain under local storage. Never commit runtime databases, login credentials, user uploads or inquiry notes.
- Preserve real image/product mapping. Display complete product photos with object-fit: contain, never crop the product.
- Frontend never displays prices. Only published, verified products are public.
- Original catalogue code and model are retained; unique SKU identifies a particular style. Existing SKUs are immutable.
- Components, custom attributes and detail blocks are arrays. Never hard-code a four-piece template or assume number of component rows equals total pieces.
- Public inquiry list is intentionally device-local. WhatsApp opens a prefilled message; it cannot attach a downloaded document automatically or prove delivery.
- All admin mutations must require server-side authorization and validation. Database changes must survive process restarts.
- Before delivery run npm run build, npm test, and verify relevant flows. Keep secrets and runtime files out of Git.
