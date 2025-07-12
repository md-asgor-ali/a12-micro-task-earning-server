const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB URI
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
    const tasksCollection = db.collection("tasks");

    // ➤ POST /users - Register new user
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
        console.error("POST /users error:", err);
        res.status(500).json({ message: "Server Error" });
      }
    });

    // ➤ GET /users/:email - Get user by email
    app.get("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (err) {
        console.error("GET /users/:email error:", err);
        res.status(500).json({ message: "Server Error" });
      }
    });

    // ➤ PATCH /users/:email/coins - Update user's coin balance
    app.patch("/users/:email/coins", async (req, res) => {
      try {
        const { email } = req.params;
        const { coins } = req.body;
        if (typeof coins !== "number") {
          return res.status(400).json({ message: "Invalid coin value" });
        }

        const result = await usersCollection.updateOne(
          { email },
          { $set: { coins } }
        );

        res.json({ modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("PATCH /users/:email/coins error:", err);
        res.status(500).json({ message: "Server Error" });
      }
    });

    // ➤ POST /tasks - Add a new task
    app.post("/tasks", async (req, res) => {
      try {
        const task = req.body;

        const requiredFields = [
          "task_title",
          "task_detail",
          "required_workers",
          "payable_amount",
          "completion_date",
          "submission_info",
          "task_image_url",
          "buyer_email",
          "total_cost",
        ];

        for (let field of requiredFields) {
          if (!task[field]) {
            return res.status(400).json({ message: `Missing field: ${field}` });
          }
        }

        task.status = "active";
        task.createdAt = new Date();

        const result = await tasksCollection.insertOne(task);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (err) {
        console.error("POST /tasks error:", err);
        res.status(500).json({ message: "Failed to add task" });
      }
    });

    // ➤ GET /tasks/buyer/:email - Get tasks added by buyer (sorted by completion date)
    app.get("/tasks/buyer/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const tasks = await tasksCollection
          .find({ buyer_email: email })
          .sort({ completion_date: -1 })
          .toArray();

        res.json(tasks);
      } catch (err) {
        console.error("GET /tasks/buyer/:email error:", err);
        res.status(500).json({ message: "Failed to fetch tasks" });
      }
    });

    // ➤ PATCH /tasks/:id - Update title, detail, and submission_info
    app.patch("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { task_title, task_detail, submission_info } = req.body;

        const updateFields = {};
        if (task_title) updateFields.task_title = task_title;
        if (task_detail) updateFields.task_detail = task_detail;
        if (submission_info) updateFields.submission_info = submission_info;

        const result = await tasksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        res.json({ modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("PATCH /tasks/:id error:", err);
        res.status(500).json({ message: "Failed to update task" });
      }
    });

    // ➤ DELETE /tasks/:id - Delete task and refund coins if active
    app.delete("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });

        if (!task) return res.status(404).json({ message: "Task not found" });

        // Refund coins only if not completed
        if (task.status === "active") {
          const refundAmount = task.required_workers * task.payable_amount;

          await usersCollection.updateOne(
            { email: task.buyer_email },
            { $inc: { coins: refundAmount } }
          );
        }

        const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ deletedCount: result.deletedCount });
      } catch (err) {
        console.error("DELETE /tasks/:id error:", err);
        res.status(500).json({ message: "Failed to delete task" });
      }
    });

    // ➤ Root route
    app.get("/", (req, res) => {
      res.send("🚀 Micro Task Dashboard Backend is Running!");
    });

    // Start server
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
  }
}

run().catch(console.dir);
