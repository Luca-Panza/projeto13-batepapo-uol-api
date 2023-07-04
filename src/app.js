import express, { json } from "express";
import { MongoClient, ObjectId } from "mongodb";
import { stripHtml } from "string-strip-html";
import cors from "cors";
import dayjs from "dayjs";
import dotenv from "dotenv";
import joi from "joi";

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

//Schemas:
const userSchema = joi.object({ user: joi.string().required().trim() });
const nameSchema = joi.object({ name: joi.string().required().trim() });
const messageSchema = joi.object({
  user: joi.string().required().trim(),
  to: joi.string().required().trim(),
  text: joi.string().required().trim(),
  type: joi.string().allow("message", "private_message").only().required(),
});

app.post("/participants", async (req, res) => {
  const { name } = req.body;

  const currentTime = dayjs().format("HH:mm:ss");
  const cleanName = stripHtml(name).result;

  const validation = nameSchema.validate({ name }, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    const existingParticipant = await db.collection("participants").findOne({ name: cleanName });

    if (existingParticipant) return res.sendStatus(409);

    await db.collection("participants").insertOne({ name: cleanName, lastStatus: Date.now() });
    await db
      .collection("messages")
      .insertOne({ from: cleanName, to: "Todos", text: "entra na sala...", type: "status", time: currentTime });
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
  const cleanUser = stripHtml(user).result;
  const cleanMessage = {
    from: cleanUser,
    to: stripHtml(to).result,
    text: stripHtml(text).result,
    type: stripHtml(type).result,
    time: currentTime,
  };

  const validation = messageSchema.validate({ user, to, text, type }, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send(errors);
  }

  try {
    const existingParticipant = await db.collection("participants").findOne({ name: cleanUser });

    if (!existingParticipant) {
      return res.sendStatus(422);
    }
    await db.collection("messages").insertOne(cleanMessage);
    res.sendStatus(201);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/messages", async (req, res) => {
  const { user } = req.headers;
  const limit = Number(req.query.limit);

  if (isNaN(limit) || limit <= 0) {
    return res.status(422).send("Invalid limit value");
  }

  try {
    const validMessages = await db
      .collection("messages")
      .find({
        $or: [
          { type: { $in: ["status", "message"] } },
          {
            $and: [
              { type: "private_message" },
              {
                $or: [
                  { from: user, to: { $ne: user } },
                  { from: { $ne: user }, to: user },
                ],
              },
            ],
          },
          { from: "Todos" },
        ],
      })
      .limit(limit)
      .toArray();
    res.status(200).send(validMessages);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete("/messages/:id", async (req, res) => {
  const { id } = req.params;
  const { user } = req.headers;

  try {
    const message = await db.collection("messages").findOne({ _id: new ObjectId(id) });
    if (!message) return res.sendStatus(404);
    if (message.from !== user) return res.sendStatus(401);

    await db.collection("messages").deleteOne({ _id: new ObjectId(id) });
    res.sendStatus(204);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/messages/:id", async (req, res) => {
  const { user } = req.headers;
  const { id } = req.params;

  const validation = messageSchema.validate({ ...req.body, from: user }, { abortEarly: false });
  if (validation.error) {
    return res.status(422).send(validation.error.details.map((detail) => detail.message));
  }

  try {
    const participant = await db.collection("participants").findOne({ name: user });
    if (!participant) return res.sendStatus(422);

    const message = await db.collection("messages").findOne({ _id: new ObjectId(id) });
    if (!message) return res.sendStatus(404);
    if (message.from !== user) return res.sendStatus(401);

    await db.collection("messages").updateOne({ _id: new ObjectId(id) }, { $set: req.body });
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/status", async (req, res) => {
  const { user } = req.headers;

  const validation = userSchema.validate({ user }, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(404).send(errors);
  }

  try {
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
