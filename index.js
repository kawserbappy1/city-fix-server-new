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
    const usersCollection = db.collection("users");
    const staffsCollection = db.collection("staffs");

    //############################################### issue related api ###############################################

    // post issue by user
    app.post("/issues", async (req, res) => {
      try {
        const issue = req.body;
        const email = issue.email;
        const user = await usersCollection.findOne({ email });
        const limits = {
          free: 5,
          standard: 50,
          premium: null,
        };
        const limit = limits[user.membership];
        //  Block if limit reached
        if (limit !== null && user.postCount >= limit) {
          return res.status(403).send({
            message: "Post limit reached. Upgrade your plan.",
          });
        }
        //  Insert issue
        const result = await issuesCollection.insertOne({
          ...issue,
          status: "pending",
          workflow: "in queue",
          assign: "waiting",
          createdAt: new Date(),
        });
        //  Increment postCount
        await usersCollection.updateOne({ email }, { $inc: { postCount: 1 } });
        res.send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
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
    // show admin approve post in the ui
    app.get("/approve-issues", async (req, res) => {
      const query = { status: "approved" };
      const result = await issuesCollection.find(query).toArray();
      res.send(result);
    });
    // get details issue
    app.get("/approve-issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await issuesCollection.findOne(query);
      res.send(result);
    });
    // get for single  details
    app.get("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const issue = await issuesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!issue) {
          return res.status(404).send({ message: "Issue not found" });
        }
        res.send(issue);
      } catch (error) {
        console.error("Error fetching issue:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // update issu before pending
    app.patch("/issue-edit/:id", async (req, res) => {
      const updateData = req.body;

      try {
        const id = req.params.id;
        const issue = await issuesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!issue) {
          return res.status(404).send({ message: "Issue not found" });
        }
        if (issue.status === "approved") {
          return res
            .status(400)
            .send({ message: "You cannot edit an approved issue" });
        }
        const result = await issuesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Error editing issue:", error);
        res.status(500).send({ message: "Internal server error" });
      }
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
          },
        }
      );
      res.send(result);
    });
    // pending issue Reject by admin
    app.patch("/issues/reject/:id", async (req, res) => {
      const id = req.params.id;
      const result = await issuesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: "rejected",
            workflow: "rejected",
            rejectedAt: new Date(),
          },
        }
      );
      res.send(result);
    });

    // delete issues by admin
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await issuesCollection.deleteOne(query);
      res.send(result);
    });

    // Assign staff to issue by admin
    app.patch("/issues/assign/:issueId", async (req, res) => {
      try {
        const { issueId } = req.params;
        const { staffId } = req.body;

        if (!staffId) {
          return res.status(400).send({ message: "staffId is required" });
        }

        // 1️⃣ Check staff
        const staff = await staffsCollection.findOne({
          _id: new ObjectId(staffId),
          status: "approved",
          availability: { $ne: "not_available" },
        });

        if (!staff) {
          return res.status(404).send({ message: "Staff not available" });
        }

        // 2️⃣ Update issue
        const result = await issuesCollection.updateOne(
          { _id: new ObjectId(issueId) },
          {
            $set: {
              assignedStaff: {
                staffId: staff._id,
                name: staff.name,
                email: staff.email,
                phone: staff.phone,
                photo: staff.staffPhoto,
                assignedAt: new Date().toISOString(),
              },
              workflow: "in-progress",
              assign: "assigned",
            },
          }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Assign staff error:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    //############################################### user related api ###############################################

    // get user role api for hook
    app.get("/user/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });
    // get membership info hook
    app.get("/users/usage/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      const limits = {
        free: 5,
        standard: 50,
        premium: null,
      };
      const limit = limits[user.membership];
      res.send({
        membership: user.membership,
        postCount: user.postCount || 0,
        limit,
        remaining: limit === null ? "unlimited" : limit - (user.postCount || 0),
      });
    });

    // create or update user
    app.post("/user", async (req, res) => {
      try {
        const userData = req.body;
        const query = { email: userData.email };
        const existingUser = await usersCollection.findOne(query);
        // If user already exists → update last login
        if (existingUser) {
          await usersCollection.updateOne(query, {
            $set: {
              last_logged_in: new Date().toISOString(),
            },
          });
          return res.send({
            success: true,
            message: "User already exists. Login time updated.",
          });
        }
        // New user
        const newUser = {
          ...userData,
          role: "user",
          membership: "free",
          postCount: 0,
          createdAt: new Date().toISOString(),
          last_logged_in: new Date().toISOString(),
        };
        const result = await usersCollection.insertOne(newUser);
        res.send({
          success: true,
          insertedId: result.insertedId,
          message: "User created successfully",
        });
      } catch (error) {
        console.error("User create error:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // update user
    app.patch("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const updatedData = req.body;
        const result = await usersCollection.updateOne(
          { email: email },
          {
            $set: updatedData,
            $currentDate: { updatedAt: true },
          }
        );
        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "User not found" });
        }
        res.send({
          success: true,
          message: "User updated successfully",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // get all users by Admin
    app.get("/user", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    // delete user by Admin
    app.delete("/user/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    //############################################### staff related api ###############################################

    // post staff
    app.post("/staff", async (req, res) => {
      const staffData = req.body;
      const updatedStaffData = {
        ...staffData,
        status: "pending",
        appliedAt: new Date().toISOString(),
      };

      const quer = {
        email: staffData.email,
      };
      const alreadyExistsStaff = await staffsCollection.findOne(quer);
      if (alreadyExistsStaff) {
        return res.status(409).send({ message: "Staff already exists" });
      }
      const result = await staffsCollection.insertOne(updatedStaffData);
      res.send(result);
    });

    // get all staff to ui for admin
    app.get("/staff", async (req, res) => {
      const result = await staffsCollection
        .find()
        .sort({ appliedAt: -1 })
        .toArray();
      res.send(result);
    });

    // get only approve staff for ui or assign
    app.get("/approve-staff", async (req, res) => {
      const query = {
        status: "approved",
        availability: { $ne: "not_available" },
      };
      const result = await staffsCollection.find(query).toArray();
      res.send(result);
    });
    // Approved staffs by admin api
    app.patch("/staff-approve/:id", async (req, res) => {
      const id = req.params.id;
      const staff = await staffsCollection.findOne({ _id: new ObjectId(id) });
      const result = await staffsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: "approved",
            approvedAt: new Date().toISOString(),
          },
        }
      );

      const userUpdateResult = await usersCollection.updateOne(
        { email: staff.email },
        {
          $set: { role: "staff" },
        }
      );

      res.send(result);
    });
    //  delete staff by admin api
    app.delete("/staff/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await staffsCollection.deleteOne(query);
      res.send(result);
    });

    // show single staff by staff profile
    app.get("/staff/:email", async (req, res) => {
      const email = req.params.email;
      const result = await staffsCollection.findOne({ email });
      if (!result) {
        return res.status(404).send({ message: "Staff not found" });
      }
      res.send(result);
    });

    // update staff info by staff
    app.patch("/staff/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedInfo = req.body;

        if (!updatedInfo) {
          return res.status(400).send({ message: "No update data provided" });
        }

        const result = await staffsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updatedInfo,
              updatedAt: new Date().toISOString(),
            },
          }
        );

        res.send(result);
      } catch (error) {
        console.error("Update staff error:", error);
        res.status(500).send({ message: "Internal server error" });
      }
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
