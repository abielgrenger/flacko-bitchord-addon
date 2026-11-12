# FLACKO on Northflank (free Sandbox, always-on)
FROM node:20-alpine

# ffmpeg needed for High (MP3 320k) / Low (MP3 128k) transcoding.
# Without it, server.js falls back to the original FLAC.
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Northflank injects PORT; server.js reads process.env.PORT (default 3000).
EXPOSE 3000
CMD ["node", "server.js"]
