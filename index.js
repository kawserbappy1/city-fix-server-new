require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 3000;

// middlewire
app.use(cors());
app.use(express.json());

const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
};

// Mongodb connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // create database and collection

    const db = client.db("city-fix");
    const issuesCollection = db.collection("issues");

    // issue related api

    // post issue by user
    app.post("/issues", async (req, res) => {
      const issues = req.body;
      const updateIssue = {
        ...issues,
        status: "pending",
        workflow: "in queue",
        createdAt: new Date(),
      };
      const result = await issuesCollection.insertOne(updateIssue);
      res.send(result);
    });

    // get all issues by admin and get personal issue by email
    app.get("/issues", async (req, res) => {
      const query = {};
      const { email } = req.query;

      if (email) {
        query.email = email;
      }

      const result = await issuesCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    // update issue by user (only if pending & owner)
    app.patch("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const { email } = req.query; // user email from frontend
      const updatedData = req.body;

      // 1️⃣ Find the issue
      const issue = await issuesCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }

      // 2️⃣ Check ownership
      if (issue.email !== email) {
        return res.status(403).send({ message: "Unauthorized" });
      }

      // 3️⃣ Prevent editing approved issues
      if (issue.status === "approved") {
        return res
          .status(400)
          .send({ message: "Approved issues cannot be edited" });
      }

      // 4️⃣ Update issue
      const result = await issuesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            issueName: updatedData.issueName,
            description: updatedData.description,
            category: updatedData.category,
            priority: updatedData.priority,
            division: updatedData.division,
            district: updatedData.district,
            upazila: updatedData.upazila,
            address: updatedData.address,
            issueImageURL: updatedData.issueImageURL,
            phoneNumber: updatedData.phoneNumber,
            updatedAt: new Date(),
          },
        }
      );

      res.send(result);
    });

    // pending issue approved by admin
    app.patch("/issues/approve/:id", async (req, res) => {
      const id = req.params.id;
      const result = await issuesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: "approved",
            workflow: "in-progress",
            approvedAt: new Date(),
            // approvedBy: req.user.email,
          },
        }
      );
      res.send(result);
    });

    // show admin approve post in the ui
    app.get("/approve-issues", async (req, res) => {
      const query = { status: "approved" };
      const result = await issuesCollection.find(query).toArray();
      res.send(result);
    });

    // get details issu
    app.get("/approve-issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await issuesCollection.findOne(query);
      res.send(result);
    });
    // delete issues by admin
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await issuesCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("City Fix is Running from port ", port);
});
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

