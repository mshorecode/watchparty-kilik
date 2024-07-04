# Use an official Node.js runtime as a parent image
FROM node:20

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Expose the ports the app runs on
EXPOSE 5173

# Define environment variables
ENV PORT=8080

# Run both the server and the React application
CMD ["sh", "-c", "npm run dev & npm run react"]

