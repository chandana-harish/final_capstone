import amqp from "amqplib";
import { DefaultAzureCredential } from "@azure/identity";
import { ServiceBusClient } from "@azure/service-bus";
import { optionalEnv, requireEnv } from "./config.js";

let channel;
let serviceBusClient;
const serviceBusSenders = new Map();
const serviceBusReceivers = new Map();

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function queueProvider() {
  return optionalEnv("QUEUE_PROVIDER", "rabbitmq").toLowerCase();
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

function getServiceBusClient() {
  if (serviceBusClient) return serviceBusClient;

  const connectionString = optionalEnv("SERVICEBUS_CONNECTION_STRING");
  if (connectionString) {
    serviceBusClient = new ServiceBusClient(connectionString);
    return serviceBusClient;
  }

  const namespace = requireEnv("SERVICEBUS_NAMESPACE");
  serviceBusClient = new ServiceBusClient(namespace, new DefaultAzureCredential());
  return serviceBusClient;
}

function getServiceBusSender(queueName) {
  if (!serviceBusSenders.has(queueName)) {
    serviceBusSenders.set(queueName, getServiceBusClient().createSender(queueName));
  }
  return serviceBusSenders.get(queueName);
}

function getServiceBusReceiver(queueName) {
  if (!serviceBusReceivers.has(queueName)) {
    serviceBusReceivers.set(queueName, getServiceBusClient().createReceiver(queueName));
  }
  return serviceBusReceivers.get(queueName);
}

async function publishRabbitMq(queueName, payload) {
  const ch = await getChannel();
  await ch.assertQueue(queueName, { durable: true });
  ch.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json"
  });
}

async function consumeRabbitMq(queueName, handler) {
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

async function publishServiceBus(queueName, payload) {
  const sender = getServiceBusSender(queueName);
  await sender.sendMessages({
    body: payload,
    contentType: "application/json"
  });
}

async function consumeServiceBus(queueName, handler) {
  const receiver = getServiceBusReceiver(queueName);
  receiver.subscribe({
    processMessage: async (message) => {
      try {
        await handler(message.body);
        await receiver.completeMessage(message);
      } catch (error) {
        console.error(`Queue handler failed for ${queueName}`, error);
        await receiver.deadLetterMessage(message, {
          deadLetterReason: "HandlerFailed",
          deadLetterErrorDescription: error.message
        });
      }
    },
    processError: async (error) => {
      console.error(`Service Bus receiver failed for ${queueName}`, error);
    }
  }, {
    autoCompleteMessages: false
  });
}

export async function publish(queueName, payload) {
  if (queueProvider() === "servicebus") {
    await publishServiceBus(queueName, payload);
    return;
  }

  await publishRabbitMq(queueName, payload);
}

export async function consume(queueName, handler) {
  if (queueProvider() === "servicebus") {
    await consumeServiceBus(queueName, handler);
    return;
  }

  await consumeRabbitMq(queueName, handler);
}
