FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose port for health checks
EXPOSE 3000

# Start bot
CMD ["npm", "start"]
