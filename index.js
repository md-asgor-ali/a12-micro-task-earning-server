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
    const submissionsCollection = db.collection("submissions");
    const withdrawalsCollection = db.collection("withdrawals");

    // ========== USER ROUTES ==========
    app.post("/users", async (req, res) => {
      const { name, email, photoURL, role } = req.body;
      if (!name || !email || !photoURL || !role)
        return res.status(400).send("Missing fields");
      const exists = await usersCollection.findOne({ email });
      if (exists) return res.status(409).send("User already exists");

      const coins = role === "Worker" ? 10 : role === "Buyer" ? 50 : 0;
      const result = await usersCollection.insertOne({
        name,
        email,
        photoURL,
        role,
        coins,
        createdAt: new Date(),
      });
      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/users/:email", async (req, res) => {
      const user = await usersCollection.findOne({ email: req.params.email });
      if (!user) return res.status(404).send("User not found");
      res.json(user);
    });

    app.patch("/users/:email/coins", async (req, res) => {
      const { coins } = req.body;
      if (typeof coins !== "number")
        return res.status(400).send("Invalid coin amount");
      const result = await usersCollection.updateOne(
        { email: req.params.email },
        { $set: { coins } }
      );
      res.json(result);
    });

    // ✅ Get Top 6 Workers by Coins
    app.get("/top-workers", async (req, res) => {
      try {
        const topWorkers = await usersCollection
          .find({ role: "Worker" })
          .sort({ coins: -1 }) // Sort by coins (highest first)
          .limit(6) // Only top 6
          .project({ name: 1, photoURL: 1, coins: 1 }) // Optional: limit returned fields
          .toArray();

        res.json(topWorkers);
      } catch (err) {
        console.error("Failed to fetch top workers:", err);
        res.status(500).send("Failed to fetch top workers");
      }
    });

    // ========== TASK ROUTES ==========
    app.post("/tasks", async (req, res) => {
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
      for (let f of requiredFields)
        if (!task[f]) return res.status(400).send(`Missing field: ${f}`);
      task.status = "active";
      task.createdAt = new Date();
      const result = await tasksCollection.insertOne(task);
      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/tasks/buyer/:email", async (req, res) => {
      const tasks = await tasksCollection
        .find({ buyer_email: req.params.email })
        .sort({ completion_date: -1 })
        .toArray();
      res.json(tasks);
    });

    app.get("/tasks/available", async (req, res) => {
      const tasks = await tasksCollection
        .find({ required_workers: { $gt: 0 } })
        .toArray();
      res.json(tasks);
    });

    app.get("/tasks/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
        if (!task) return res.status(404).send("Task not found");
        res.json(task);
      } catch (err) {
        res.status(400).send("Invalid task ID");
      }
    });

    app.patch("/tasks/:id", async (req, res) => {
      const { task_title, task_detail, submission_info } = req.body;
      const updates = {};
      if (task_title) updates.task_title = task_title;
      if (task_detail) updates.task_detail = task_detail;
      if (submission_info) updates.submission_info = submission_info;

      const result = await tasksCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updates }
      );
      res.json(result);
    });

    app.delete("/tasks/:id", async (req, res) => {
      const task = await tasksCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!task) return res.status(404).send("Task not found");
      if (task.status === "active") {
        const refund = task.required_workers * task.payable_amount;
        await usersCollection.updateOne(
          { email: task.buyer_email },
          { $inc: { coins: refund } }
        );
      }
      const result = await tasksCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json(result);
    });

    // ===== SUBMISSION ROUTES =====
    app.post("/submissions", async (req, res) => {
      const submission = req.body;
      if (!submission.task_id || !submission.worker_email) {
        return res.status(400).send("Missing submission data");
      }
      submission.status = "pending";
      submission.submittedAt = new Date();
      const result = await submissionsCollection.insertOne(submission);

      await tasksCollection.updateOne(
        { _id: new ObjectId(submission.task_id) },
        { $inc: { required_workers: -1 } }
      );

      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/submissions/worker", async (req, res) => {
      const { email } = req.query;
      const submissions = await submissionsCollection
        .find({ worker_email: email })
        .sort({ submittedAt: -1 })
        .toArray();
      res.json(submissions);
    });

    app.get("/submissions/worker/approved", async (req, res) => {
      const { email } = req.query;
      const submissions = await submissionsCollection
        .find({ worker_email: email, status: "approved" })
        .sort({ submittedAt: -1 })
        .toArray();
      res.json(submissions);
    });

    app.get("/worker/stats", async (req, res) => {
      const { email } = req.query;
      const all = await submissionsCollection
        .find({ worker_email: email })
        .toArray();
      const total = all.length;
      const pending = all.filter((s) => s.status === "pending").length;
      const earnings = all
        .filter((s) => s.status === "approved")
        .reduce((sum, s) => sum + (s.payable_amount || 0), 0);
      res.json({
        totalSubmissions: total,
        pendingSubmissions: pending,
        totalEarnings: earnings,
      });
    });

    // ===== SUBMISSION REVIEW ROUTES =====
    app.get("/submissions/pending", async (req, res) => {
      const { buyerEmail } = req.query;
      const result = await submissionsCollection
        .find({ buyer_email: buyerEmail, status: "pending" })
        .toArray();
      res.json(result);
    });

    app.patch("/submissions/approve/:id", async (req, res) => {
      const { workerEmail, payableAmount } = req.body;
      const submissionId = req.params.id;

      await usersCollection.updateOne(
        { email: workerEmail },
        { $inc: { coins: payableAmount } }
      );
      const result = await submissionsCollection.updateOne(
        { _id: new ObjectId(submissionId) },
        { $set: { status: "approved" } }
      );

      res.json(result);
    });

    app.patch("/submissions/reject/:id", async (req, res) => {
      const submissionId = req.params.id;
      const { taskId } = req.body;

      await tasksCollection.updateOne(
        { _id: new ObjectId(taskId) },
        { $inc: { required_workers: 1 } }
      );

      const result = await submissionsCollection.updateOne(
        { _id: new ObjectId(submissionId) },
        { $set: { status: "rejected" } }
      );

      res.json(result);
    });

    app.get("/buyer/stats", async (req, res) => {
      const { email } = req.query;
      const tasks = await tasksCollection
        .find({ buyer_email: email })
        .toArray();
      const taskCount = tasks.length;
      const pendingWorkers = tasks.reduce(
        (sum, t) => sum + (t.required_workers || 0),
        0
      );

      const submissions = await submissionsCollection
        .find({ buyer_email: email, status: "approved" })
        .toArray();
      const totalPaid = submissions.reduce(
        (sum, s) => sum + (s.payable_amount || 0),
        0
      );

      res.json({ taskCount, pendingWorkers, totalPaid });
    });

    // ===== WITHDRAWALS =====
    app.post("/withdrawals", async (req, res) => {
      const withdrawal = req.body;
      if (
        !withdrawal.worker_email ||
        !withdrawal.worker_name ||
        !withdrawal.withdrawal_coin ||
        !withdrawal.withdrawal_amount ||
        !withdrawal.payment_system ||
        !withdrawal.account_number
      ) {
        return res.status(400).send("Missing withdrawal fields");
      }

      const result = await withdrawalsCollection.insertOne({
        ...withdrawal,
        withdraw_date: new Date(),
        status: "pending",
      });
      await usersCollection.updateOne(
        { email: withdrawal.worker_email },
        { $inc: { coins: -Number(withdrawal.withdrawal_coin) } }
      );

      res.status(201).json({ insertedId: result.insertedId });
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
      if (!email || !coins || !amount || !transactionId)
        return res.status(400).send("Missing payment info");

      const result = await paymentsCollection.insertOne({
        ...req.body,
        paidAt: new Date(),
      });
      await usersCollection.updateOne({ email }, { $inc: { coins } });
      res.status(201).json({ insertedId: result.insertedId });
    });

    app.get("/payments/:email", async (req, res) => {
      const result = await paymentsCollection
        .find({ email: req.params.email })
        .sort({ paidAt: -1 })
        .toArray();
      res.json(result);
    });

    // ----------- ADMIN DASHBOARD ROUTES -----------

    // 1. Admin-Home Stats
    app.get("/admin/stats", async (req, res) => {
      try {
        const totalWorkers = await usersCollection.countDocuments({
          role: "Worker",
        });
        const totalBuyers = await usersCollection.countDocuments({
          role: "Buyer",
        });

        const coinAggregation = await usersCollection
          .aggregate([
            { $group: { _id: null, totalCoins: { $sum: "$coins" } } },
          ])
          .toArray();
        const totalCoins = coinAggregation[0]?.totalCoins || 0;

        const totalPaymentsCount = await paymentsCollection.countDocuments();

        res.json({
          totalWorkers,
          totalBuyers,
          totalCoins,
          totalPayments: totalPaymentsCount,
        });
      } catch (error) {
        res.status(500).send("Failed to fetch admin stats");
      }
    });

    // 2. Withdraw Requests (Pending)
    app.get("/withdrawals/pending", async (req, res) => {
      try {
        const pendingRequests = await withdrawalsCollection
          .find({ status: "pending" })
          .sort({ withdraw_date: -1 })
          .toArray();
        res.json(pendingRequests);
      } catch (error) {
        res.status(500).send("Failed to fetch withdrawal requests");
      }
    });

    // Approve Withdrawal Request and Update User Coins
    app.patch("/withdrawals/approve/:id", async (req, res) => {
      try {
        const withdrawalId = req.params.id;
        const withdrawal = await withdrawalsCollection.findOne({
          _id: new ObjectId(withdrawalId),
        });
        if (!withdrawal)
          return res.status(404).send("Withdrawal request not found");
        if (withdrawal.status === "approved")
          return res.status(400).send("Already approved");

        await withdrawalsCollection.updateOne(
          { _id: new ObjectId(withdrawalId) },
          { $set: { status: "approved" } }
        );

        // No additional coin deduction here because coins were deducted on withdrawal request creation

        res.json({ message: "Withdrawal approved successfully" });
      } catch (error) {
        res.status(500).send("Failed to approve withdrawal");
      }
    });

    // 3. Manage Users

    // Get all users
    app.get("/admin/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.json(users);
      } catch (error) {
        res.status(500).send("Failed to fetch users");
      }
    });

    // Delete user by ID
    app.delete("/admin/users/:id", async (req, res) => {
      try {
        const userId = req.params.id;
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(userId),
        });
        if (result.deletedCount === 0)
          return res.status(404).send("User not found");
        res.json({ message: "User deleted successfully" });
      } catch (error) {
        res.status(500).send("Failed to delete user");
      }
    });

    // Update user role by ID
    app.patch("/admin/users/:id/role", async (req, res) => {
      try {
        const userId = req.params.id;
        const { role } = req.body;
        if (!["Admin", "Buyer", "Worker"].includes(role)) {
          return res.status(400).send("Invalid role");
        }
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role } }
        );
        if (result.matchedCount === 0)
          return res.status(404).send("User not found");
        res.json({ message: "User role updated successfully" });
      } catch (error) {
        res.status(500).send("Failed to update user role");
      }
    });

    // 4. Manage Tasks

    // Get all tasks
    app.get("/admin/tasks", async (req, res) => {
      try {
        const tasks = await tasksCollection.find().toArray();
        res.json(tasks);
      } catch (error) {
        res.status(500).send("Failed to fetch tasks");
      }
    });

    // Delete task by ID
    app.delete("/admin/tasks/:id", async (req, res) => {
      try {
        const taskId = req.params.id;
        const task = await tasksCollection.findOne({
          _id: new ObjectId(taskId),
        });
        if (!task) return res.status(404).send("Task not found");

        if (task.status === "active") {
          const refund = task.required_workers * task.payable_amount;
          await usersCollection.updateOne(
            { email: task.buyer_email },
            { $inc: { coins: refund } }
          );
        }

        const result = await tasksCollection.deleteOne({
          _id: new ObjectId(taskId),
        });
        res.json({ message: "Task deleted successfully" });
      } catch (error) {
        res.status(500).send("Failed to delete task");
      }
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
