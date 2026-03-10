FROM node:20-alpine AS builder

WORKDIR /app

# Install root dependencies (Next.js backend)
COPY package*.json ./
RUN npm install

# Install frontend dependencies (Vite app)
COPY Front_end/package*.json ./Front_end/
RUN cd Front_end && npm install

# Copy the rest of the source code
COPY . .

# Build frontend and backend
# This runs scripts/combine-build.js then next build
RUN npm run build


FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Only copy what is needed to run the app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/pages ./pages
COPY --from=builder /app/lib ./lib

# If you use any additional runtime files (e.g. vercel.json, netlify.toml),
# copy them here as needed. They are not required for basic Docker runtime.

EXPOSE 3000

# Start the Next.js server
CMD ["npm", "start"]


