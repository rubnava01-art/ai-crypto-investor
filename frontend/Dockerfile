FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
# Next sirve los archivos de public/ desde la raíz del proyecto en
# tiempo de ejecución: sin esta línea, /sounds/*.mp3 da 404 aunque el
# build nuevo esté desplegado (fue la causa de que la meditación no
# sonara con las grabaciones reales).
COPY --from=build /app/public ./public
# Runtime needs only prod deps (next, react, react-dom). Installing them
# fresh instead of copying the build image's node_modules leaves out the
# whole dev toolchain (typescript, tailwind, postcss...) — smaller image,
# faster deploys and restarts on the free tier.
COPY package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["npm", "start"]
