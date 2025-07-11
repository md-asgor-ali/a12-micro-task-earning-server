const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cnz4d0t.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("microTaskDB");
    const usersCollection = db.collection("users");

    // ➤ POST /users - Register user
    app.post("/users", async (req, res) => {
      try {
        const { name, email, photoURL, role } = req.body;

        if (!name || !email || !photoURL || !role) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(400).json({ message: "User already exists" });
        }

        const coins = role === "Worker" ? 10 : role === "Buyer" ? 50 : 0;

        const newUser = {
          name,
          email,
          photoURL,
          role,
          coins,
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (err) {
        console.error("Error in POST /users:", err);
        res.status(500).json({ message: "Server Error" });
      }
    });

    // ➤ GET /users/:email - Fetch user by email
    app.get("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
      } catch (err) {
        console.error("Error in GET /users/:email:", err);
        res.status(500).json({ message: "Server Error" });
      }
    });

    // ➤ PATCH /users/:email/coins - Update user coins
    app.patch("/users/:email/coins", async (req, res) => {
      try {
        const { email } = req.params;
        const { coins } = req.body;

        if (typeof coins !== "number") {
          return res.status(400).json({ message: "Invalid coins value" });
        }

        const result = await usersCollection.updateOne(
          { email },
          { $set: { coins } }
        );

        res.json({ modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("Error in PATCH /users/:email/coins:", err);
        res.status(500).json({ message: "Server Error" });
      }
    });

    // Root
    app.get("/", (req, res) => {
      res.send("🚀 Micro Task Dashboard Backend is Running!");
    });

    // Start server
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (err) {
    console.error("MongoDB connection failed:", err);
  }
}

run().catch(console.dir);
