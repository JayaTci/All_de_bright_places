# Builds a local production preview with the same workspace command used on Vercel.
FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY All_de_bright_placesFrontend ./All_de_bright_placesFrontend
COPY All_de_bright_placesBackend ./All_de_bright_placesBackend
COPY All_de_bright_placesShared ./All_de_bright_placesShared
RUN pnpm install --frozen-lockfile && pnpm build
EXPOSE 3000
CMD ["pnpm", "--filter", "@bright/frontend", "exec", "next", "start", "--hostname", "0.0.0.0"]
