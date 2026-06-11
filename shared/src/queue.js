import amqp from "amqplib";
import { requireEnv } from "./config.js";

let channel;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getChannel() {
  if (channel) return channel;
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const connection = await amqp.connect(requireEnv("RABBITMQ_URL"));
      connection.on("close", () => {
        channel = undefined;
      });
      channel = await connection.createChannel();
      return channel;
    } catch (error) {
      lastError = error;
      console.error(`RabbitMQ connection attempt ${attempt} failed: ${error.message}`);
      await sleep(2000);
    }
  }
  throw lastError;
}

export async function publish(queueName, payload) {
  const ch = await getChannel();
  await ch.assertQueue(queueName, { durable: true });
  ch.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json"
  });
}

export async function consume(queueName, handler) {
  const ch = await getChannel();
  await ch.assertQueue(queueName, { durable: true });
  ch.consume(queueName, async (message) => {
    if (!message) return;
    try {
      const payload = JSON.parse(message.content.toString("utf8"));
      await handler(payload);
      ch.ack(message);
    } catch (error) {
      console.error(`Queue handler failed for ${queueName}`, error);
      ch.nack(message, false, false);
    }
  });
}
