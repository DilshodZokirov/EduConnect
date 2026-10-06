# 1) React ilovani yig'ish
FROM node:20-alpine AS build
WORKDIR /web
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# 2) Tayyor fayllarni nginx orqali tarqatish
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html/app
