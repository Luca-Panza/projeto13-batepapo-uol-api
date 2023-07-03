import express, { json } from "express";
import { MongoClient } from "mongodb";
import cors from "cors";
import dayjs from "dayjs";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(json());

const mongoClient = new MongoClient(process.env.DATABASE_URL);

try {
  await mongoClient.connect();
  console.log("MongoDB Connected!");
} catch (err) {
  console.log(err.message);
}
const db = mongoClient.db();

app.post("/participants", async (req, res) => {
  const { name } = req.body;

  const currentTime = dayjs().format("HH:mm:ss");

  try {
    if (!name) {
      return res.sendStatus(422);
    }

    const existingParticipant = await db.collection("participants").findOne({ name });

    if (existingParticipant) {
      return res.sendStatus(409);
    }

    await db.collection("participants").insertOne({ name, lastStatus: Date.now() });
    await db.collection("messages").insertOne({ from: name, to: "Todos", text: "entra na sala...", type: "status", time: currentTime });
    res.sendStatus(201);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/participants", async (req, res) => {
  try {
    const data = await db.collection("participants").find().toArray();
    res.status(200).send(data);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/messages", async (req, res) => {
  const { to, text, type } = req.body;
  const { user } = req.headers;

  const currentTime = dayjs().format("HH:mm:ss");

  try {
    if (typeof to !== "string" || to === "" || typeof text !== "string" || text === "") {
      return res.sendStatus(422);
    }

    if (type !== "message" && type !== "private_message") {
      return res.sendStatus(422);
    }

    const existingParticipant = await db.collection("participants").findOne({ name: user });

    if (!existingParticipant) {
      return res.sendStatus(422);
    }
    await db.collection("messages").insertOne({ from: user, to, text, type: type, time: currentTime });
    res.sendStatus(201);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/messages", async (req, res) => {
  const { user } = req.headers;
  const limit = Number(req.query.limit);

  try {
    if (isNaN(limit) || limit <= 0) {
      return res.status(422).send("Invalid limit value");
    }

    const validMessages = await db
      .collection("messages")
      .find({
        $or: [{ type: { $in: ["private_message", "status", "message"] } }, { from: { $in: ["Todos", user] } }, { to: user }],
      })
      .limit(limit)
      .toArray();
    res.status(200).send(validMessages);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/status", async (req, res) => {
  const { user } = req.headers;

  const currentTime = dayjs().format("HH:mm:ss");

  try {
    if (!user) {
      return res.sendStatus(404);
    }

    const existingParticipant = await db.collection("participants").findOne({ name: user });

    if (!existingParticipant) {
      return res.sendStatus(404);
    }

    existingParticipant.lastStatus = Date.now();
    await db.collection("participants").updateOne({ name: user }, { $set: { lastStatus: existingParticipant.lastStatus } });

    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(500);
  }
});

setInterval(async () => {
  try {
    const currentTime = dayjs().format("HH:mm:ss");

    const inactiveParticipants = await db
      .collection("participants")
      .find({ lastStatus: { $lt: Date.now() - 10000 } })
      .toArray();

    for (const participant of inactiveParticipants) {
      await db.collection("participants").deleteOne({ _id: participant._id });

      const message = {
        from: participant.name,
        to: "Todos",
        text: "sai da sala...",
        type: "status",
        time: currentTime,
      };
      await db.collection("messages").insertOne(message);
    }
  } catch (err) {
    console.error(err);
  }
}, 15000);

const PORT = 5000;
app.listen(PORT, () => console.log(`Port:${PORT}/`));
