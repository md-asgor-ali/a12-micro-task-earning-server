// microTaskBackend/index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

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
    const tasksCollection = db.collection("tasks");
    const paymentsCollection = db.collection("payments");

    // ========== USER ROUTES ==========
    app.post("/users", async (req, res) => {
      const { name, email, photoURL, role } = req.body;
      if (!name || !email || !photoURL || !role) return res.status(400).send("Missing fields");
      const exists = await usersCollection.findOne({ email });
      if (exists) return res.status(409).send("User already exists");

      const coins = role === "Worker" ? 10 : role === "Buyer" ? 50 : 0;
      const result = await usersCollection.insertOne({ name, email, photoURL, role, coins, createdAt: new Date() });
      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/users/:email", async (req, res) => {
      const user = await usersCollection.findOne({ email: req.params.email });
      if (!user) return res.status(404).send("User not found");
      res.json(user);
    });

    app.patch("/users/:email/coins", async (req, res) => {
      const { coins } = req.body;
      if (typeof coins !== "number") return res.status(400).send("Invalid coin amount");
      const result = await usersCollection.updateOne({ email: req.params.email }, { $set: { coins } });
      res.json(result);
    });

    // ========== TASK ROUTES ==========
    app.post("/tasks", async (req, res) => {
      const task = req.body;
      const requiredFields = ["task_title", "task_detail", "required_workers", "payable_amount", "completion_date", "submission_info", "task_image_url", "buyer_email", "total_cost"];
      for (let f of requiredFields) if (!task[f]) return res.status(400).send(`Missing field: ${f}`);
      task.status = "active";
      task.createdAt = new Date();
      const result = await tasksCollection.insertOne(task);
      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/tasks/buyer/:email", async (req, res) => {
      const tasks = await tasksCollection.find({ buyer_email: req.params.email }).sort({ completion_date: -1 }).toArray();
      res.json(tasks);
    });

    app.patch("/tasks/:id", async (req, res) => {
      const { task_title, task_detail, submission_info } = req.body;
      const updates = {};
      if (task_title) updates.task_title = task_title;
      if (task_detail) updates.task_detail = task_detail;
      if (submission_info) updates.submission_info = submission_info;

      const result = await tasksCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: updates });
      res.json(result);
    });

    app.delete("/tasks/:id", async (req, res) => {
      const task = await tasksCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!task) return res.status(404).send("Task not found");
      if (task.status === "active") {
        const refund = task.required_workers * task.payable_amount;
        await usersCollection.updateOne({ email: task.buyer_email }, { $inc: { coins: refund } });
      }
      const result = await tasksCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.json(result);
    });

    // ========== STRIPE PAYMENT ==========
    app.post("/create-payment-intent", async (req, res) => {
      const { coins, email } = req.body;
      const priceMap = { 10: 1, 150: 10, 500: 20, 1000: 35 };
      const amount = priceMap[coins];
      if (!amount) return res.status(400).send("Invalid coin package");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.post("/payments", async (req, res) => {
      const { email, coins, amount, transactionId } = req.body;
      if (!email || !coins || !amount || !transactionId) return res.status(400).send("Missing payment info");

      const result = await paymentsCollection.insertOne({ ...req.body, paidAt: new Date() });
      await usersCollection.updateOne({ email }, { $inc: { coins } });
      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/payments/:email", async (req, res) => {
      const result = await paymentsCollection.find({ email: req.params.email }).sort({ paidAt: -1 }).toArray();
      res.json(result);
    });

    // ========== ROOT ==========
    app.get("/", (req, res) => {
      res.send("🚀 Micro Task Dashboard Backend is Running!");
    });

    app.listen(port, () => console.log(`🚀 Server listening on port ${port}`));
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
  }
}

run().catch(console.dir);
