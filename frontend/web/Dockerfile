FROM node:26-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Vite bakes VITE_* vars into the static bundle at build time, so a runtime
# env var on the container would be too late — it has to come in as a
# build arg.
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
# The public origin of object storage, for the CSP (see docker-compose.yml).
ENV CSP_S3_ORIGIN=http://localhost:8333

EXPOSE 80
