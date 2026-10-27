require("dotenv").config();

const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const client = new MongoClient(process.env.MONGODB_URI);
const DB = process.env.MONGODB_DATABASE || "FreshTrack";
const MAX = 100;

fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });

app.use(express.json({ limit: "1mb" }));

app.use(
  session({
    name: "freshtrack.sid",
    secret: process.env.SESSION_SECRET || "dev-only-change-this-secret",
    resave: false,
    saveUninitialized: false,
    store: process.env.MONGODB_URI
      ? MongoStore.create({
          mongoUrl: process.env.MONGODB_URI,
          dbName: DB
        })
      : undefined,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, "uploads"),
    filename: (_req, file, cb) =>
      cb(
        null,
        crypto.randomUUID() +
          path.extname(file.originalname).toLowerCase()
      )
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, [".pdf", ".png", ".jpg", ".jpeg"].includes(ext));
  }
});

let users;
let products;
let offers;
let donations;
let messages;
let notifications;
let waste;
let reviews;

const id = value =>
  ObjectId.isValid(value) ? new ObjectId(value) : null;

const meSafe = user => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  shopName: user.shopName || "",
  role: user.role,
  status: user.status || "active"
});

const auth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please sign in." });
  }
  next();
};

const roles = (...allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(req.session.role)) {
    return res.status(403).json({ error: "Permission denied." });
  }
  next();
};

const current = req => users.findOne({
  _id: id(req.session.userId)
});

async function notify(userId, title, body) {
  await notifications.insertOne({
    userId: String(userId),
    title,
    body,
    read: false,
    createdAt: new Date()
  });
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, maxItems: MAX });
});

// Current signed-in account
app.get("/api/me", auth, async (req, res) => {
  const user = await current(req);

  if (!user || user.status === "disabled") {
    return res.status(401).json({ error: "Account unavailable." });
  }

  res.json({
    user: meSafe(user),
    maxItems: MAX
  });
});

// Register shopkeeper or NGO
app.post("/api/auth/register", async (req, res) => {
  try {
    let { name, email, password, shopName, role } = req.body;

    email = String(email || "").trim().toLowerCase();

    if (
      !name ||
      !email ||
      !password ||
      String(password).length < 8
    ) {
      return res.status(400).json({
        error: "Enter your name, email and a password of at least 8 characters."
      });
    }

    if (await users.findOne({ email })) {
      return res.status(409).json({
        error: "Email already registered."
      });
    }

    // Public registration cannot create an admin account.
    role = role === "ngo" ? "ngo" : "shopkeeper";

    const user = {
      name: String(name).trim().slice(0, 100),
      email,
      passwordHash: await bcrypt.hash(password, 12),
      shopName: String(shopName || "").slice(0, 120),
      role,
      status: "active",
      createdAt: new Date()
    };

    const result = await users.insertOne(user);
    user._id = result.insertedId;

    req.session.userId = String(result.insertedId);
    req.session.role = role;

    res.status(201).json({ user: meSafe(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Registration failed." });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = await users.findOne({ email });
  console.log("Email received:", JSON.stringify(email));
  console.log("Database name:", DB);

console.log("Login attempt:", email);
console.log("User found:", !!user);
console.log("Has password hash:", !!user?.passwordHash);
console.log("Account status:", user?.status);

if (!user) {
  return res.status(401).json({
    error: "Incorrect email or password."
  });
}

if (user.status === "disabled") {
  return res.status(401).json({
    error: "Incorrect email or password."
  });
}

const passwordMatches = await bcrypt.compare(
  password,
  user.passwordHash || ""
);

console.log("Password matches:", passwordMatches);

if (!passwordMatches) {
  return res.status(401).json({
    error: "Incorrect email or password."
  });
}

  req.session.userId = String(user._id);
  req.session.role = user.role;

  res.json({ user: meSafe(user) });
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({ error: "Logout failed." });
    }

    res.clearCookie("freshtrack.sid");
    res.json({ ok: true });
  });
});

// ADMIN: overview statistics
app.get("/api/admin/overview", auth, roles("admin"), async (_req, res) => {
  res.json({
    shopkeepers: await users.countDocuments({ role: "shopkeeper" }),
    ngos: await users.countDocuments({ role: "ngo" }),
    pendingLicences: await users.countDocuments({
      role: "shopkeeper",
      licenceStatus: "pending"
    }),
    productCount: await products.countDocuments({}),
    donationCount: await donations.countDocuments({}),
    openDonations: await donations.countDocuments({
      status: { $in: ["requested", "accepted"] }
    }),
    recentMessages: await messages.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 86400000) }
    })
  });
});

// ADMIN: list users
app.get("/api/admin/users", auth, roles("admin"), async (_req, res) => {
  const list = await users.find(
    { role: { $in: ["shopkeeper", "ngo"] } },
    { projection: { passwordHash: 0 } }
  ).sort({ createdAt: -1 }).limit(500).toArray();

  res.json(list.map(user => ({
    ...meSafe(user),
    licenceStatus: user.licenceStatus || "not submitted"
  })));
});

// ADMIN: enable or disable a user
app.patch("/api/admin/users/:id", auth, roles("admin"), async (req, res) => {
  const userId = id(req.params.id);

  if (!userId) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  const result = await users.updateOne(
    { _id: userId, role: { $ne: "admin" } },
    {
      $set: {
        status: req.body.status === "disabled" ? "disabled" : "active"
      }
    }
  );

  res.json({ ok: Boolean(result.matchedCount) });
});

// Shopkeeper licence upload
app.post(
  "/api/licence",
  auth,
  roles("shopkeeper"),
  upload.single("licence"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "Choose a PDF, PNG or JPG licence."
      });
    }

    await users.updateOne(
      { _id: id(req.session.userId) },
      {
        $set: {
          licenceFile: req.file.filename,
          licenceStatus: "pending"
        }
      }
    );

    await notify(
      "admin",
      "Licence submitted",
      "A shopkeeper has submitted a licence for review."
    );

    res.json({ message: "Licence submitted for review." });
  }
);

// ADMIN: view submitted licences
app.get("/api/admin/licences", auth, roles("admin"), async (_req, res) => {
  const list = await users.find(
    {
      role: "shopkeeper",
      licenceStatus: { $exists: true }
    },
    { projection: { passwordHash: 0 } }
  ).toArray();

  res.json(list.map(user => ({
    ...meSafe(user),
    licenceStatus: user.licenceStatus,
    licenceFile: user.licenceFile
  })));
});

// ADMIN: approve or reject licence
app.patch(
  "/api/admin/licences/:id",
  auth,
  roles("admin"),
  async (req, res) => {
    const userId = id(req.params.id);
    const status = req.body.status;

    if (!userId || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid ID or status." });
    }

    const user = await users.findOne({
      _id: userId,
      role: "shopkeeper"
    });

    if (!user) {
      return res.status(404).json({ error: "Shop not found." });
    }

    await users.updateOne(
      { _id: userId },
      { $set: { licenceStatus: status } }
    );

    await notify(
      String(userId),
      `Licence ${status}`,
      `Your licence was ${status}.`
    );

    res.json({ ok: true });
  }
);

// INVENTORY: list products
app.get("/api/products", auth, async (req, res) => {
  const filter = req.session.role === "admin"
    ? {}
    : { ownerId: req.session.userId };

  const list = await products.find(filter)
    .sort({ createdAt: -1 })
    .limit(req.session.role === "admin" ? 1000 : MAX)
    .toArray();

  res.json(list.map(product => ({
    ...product,
    id: String(product._id)
  })));
});

// INVENTORY: add product (server-enforced 100-item maximum)
app.post("/api/products", auth, roles("shopkeeper"), async (req, res) => {
  const body = req.body;
  const quantity = Number(body.quantity);
  const price = Number(body.price || 0);

  if (
    !String(body.name || "").trim() ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    !body.expiryDate ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    return res.status(400).json({
      error: "Check the product details."
    });
  }

  if (await products.countDocuments({ ownerId: req.session.userId }) >= MAX) {
    return res.status(409).json({
      error: "Maximum 100 products per shop reached."
    });
  }

  const product = {
    ownerId: req.session.userId,
    name: String(body.name).trim().slice(0, 120),
    quantity,
    expiryDate: String(body.expiryDate),
    category: String(body.category || "Other").slice(0, 60),
    price,
    notes: String(body.notes || "").slice(0, 500),
    createdAt: new Date()
  };

  const result = await products.insertOne(product);

  res.status(201).json({
    ...product,
    id: String(result.insertedId)
  });
});

// INVENTORY: edit product
app.put("/api/products/:id", auth, roles("shopkeeper"), async (req, res) => {
  const productId = id(req.params.id);
  const body = req.body;
  const quantity = Number(body.quantity);
  const price = Number(body.price || 0);

  if (
    !productId ||
    !String(body.name || "").trim() ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    !body.expiryDate ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    return res.status(400).json({ error: "Check the product details." });
  }

  const result = await products.updateOne(
    { _id: productId, ownerId: req.session.userId },
    {
      $set: {
        name: String(body.name).trim().slice(0, 120),
        quantity,
        expiryDate: String(body.expiryDate),
        category: String(body.category || "Other").slice(0, 60),
        price,
        notes: String(body.notes || "").slice(0, 500)
      }
    }
  );

  res.status(result.matchedCount ? 200 : 404).json({
    ok: Boolean(result.matchedCount)
  });
});

// INVENTORY: delete product
app.delete("/api/products/:id", auth, roles("shopkeeper"), async (req, res) => {
  const productId = id(req.params.id);

  if (!productId) {
    return res.status(400).json({ error: "Invalid product ID." });
  }

  const result = await products.deleteOne({
    _id: productId,
    ownerId: req.session.userId
  });

  await offers.deleteMany({
    ownerId: req.session.userId,
    productId: req.params.id
  });

  res.status(result.deletedCount ? 200 : 404).json({
    ok: Boolean(result.deletedCount)
  });
});

// OFFERS
app.get("/api/offers", auth, async (req, res) => {
  const filter = req.session.role === "admin"
    ? {}
    : { ownerId: req.session.userId };

  res.json(await offers.find(filter).sort({ createdAt: -1 }).toArray());
});

app.post("/api/offers", auth, roles("shopkeeper"), async (req, res) => {
  const productId = id(req.body.productId);
  const discountPercent = Number(req.body.discountPercent);

  const product = productId
    ? await products.findOne({
        _id: productId,
        ownerId: req.session.userId
      })
    : null;

  if (!product || discountPercent < 1 || discountPercent > 90) {
    return res.status(400).json({
      error: "Choose a product and a discount between 1% and 90%."
    });
  }

  const offer = {
    ownerId: req.session.userId,
    productId: String(product._id),
    name: product.name,
    discountPercent,
    description: String(req.body.description || "").slice(0, 500),
    createdAt: new Date()
  };

  const result = await offers.insertOne(offer);

  res.status(201).json({
    ...offer,
    id: String(result.insertedId)
  });
});

app.delete("/api/offers/:id", auth, roles("shopkeeper"), async (req, res) => {
  const offerId = id(req.params.id);

  if (!offerId) {
    return res.status(400).json({ error: "Invalid offer ID." });
  }

  const result = await offers.deleteOne({
    _id: offerId,
    ownerId: req.session.userId
  });

  res.status(result.deletedCount ? 200 : 404).json({
    ok: Boolean(result.deletedCount)
  });
});

// Active NGO directory
app.get("/api/ngos", auth, async (_req, res) => {
  const list = await users.find(
    { role: "ngo", status: "active" },
    { projection: { name: 1, email: 1 } }
  ).toArray();

  res.json(list.map(user => ({
    id: String(user._id),
    name: user.name,
    email: user.email
  })));
});

// DONATIONS: list
app.get("/api/donations", auth, async (req, res) => {
  let filter = {};

  if (req.session.role === "ngo") {
    filter = { recipientId: req.session.userId };
  } else if (req.session.role === "shopkeeper") {
    filter = { ownerId: req.session.userId };
  }

  res.json(await donations.find(filter).sort({ createdAt: -1 }).toArray());
});

// DONATIONS: shopkeeper offers stock to an NGO
app.post("/api/donations", auth, roles("shopkeeper"), async (req, res) => {
  const body = req.body;
  const productId = id(body.productId);
  const quantity = Number(body.quantity);

  const product = productId
    ? await products.findOne({
        _id: productId,
        ownerId: req.session.userId
      })
    : null;

  const ngoId = id(body.recipientId);
  const ngo = ngoId
    ? await users.findOne({
        _id: ngoId,
        role: "ngo",
        status: "active"
      })
    : null;

  if (
    !product ||
    !ngo ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    product.quantity < quantity
  ) {
    return res.status(400).json({
      error: "Choose an active NGO and a valid quantity within available stock."
    });
  }

  // Decrease stock only if enough quantity remains.
  const changed = await products.updateOne(
    {
      _id: product._id,
      ownerId: req.session.userId,
      quantity: { $gte: quantity }
    },
    { $inc: { quantity: -quantity } }
  );

  if (!changed.modifiedCount) {
    return res.status(409).json({
      error: "Stock changed. Refresh and try again."
    });
  }

  const shop = await current(req);

  const donation = {
    ownerId: req.session.userId,
    shopName: shop.shopName || shop.name,
    recipientId: String(ngo._id),
    recipientName: ngo.name,
    productId: String(product._id),
    productName: product.name,
    quantity,
    notes: String(body.notes || "").slice(0, 1000),
    status: "requested",
    createdAt: new Date()
  };

  const result = await donations.insertOne(donation);

  await notify(
    String(ngo._id),
    "New donation offer",
    `${donation.shopName} offered ${quantity} ${product.name}.`
  );

  await messages.insertOne({
    fromId: "system",
    fromName: "FreshTrack",
    toId: String(ngo._id),
    toName: ngo.name,
    subject: "New donation offer",
    body: `${donation.shopName} offered ${quantity} ${product.name}. ${donation.notes}`,
    createdAt: new Date(),
    read: false
  });

  res.status(201).json({
    ...donation,
    id: String(result.insertedId)
  });
});

// DONATIONS: status updates
app.patch("/api/donations/:id", auth, async (req, res) => {
  const donationId = id(req.params.id);
  const status = req.body.status;

  if (!donationId) {
    return res.status(400).json({ error: "Invalid donation ID." });
  }

  const donation = await donations.findOne({ _id: donationId });

  if (
    !donation ||
    !["accepted", "rejected", "completed", "cancelled"].includes(status)
  ) {
    return res.status(400).json({ error: "Invalid donation or status." });
  }

  const allowed =
    req.session.role === "admin" ||
    (
      req.session.role === "ngo" &&
      donation.recipientId === req.session.userId &&
      ["accepted", "rejected", "completed"].includes(status)
    ) ||
    (
      req.session.role === "shopkeeper" &&
      donation.ownerId === req.session.userId &&
      status === "cancelled"
    );

  if (!allowed) {
    return res.status(403).json({ error: "Permission denied." });
  }

  await donations.updateOne(
    { _id: donation._id },
    { $set: { status, updatedAt: new Date() } }
  );

  const recipient = req.session.role === "ngo"
    ? donation.ownerId
    : donation.recipientId;

  await notify(
    recipient,
    "Donation updated",
    `${donation.productName}: ${status}`
  );

  res.json({ ok: true });
});

// MESSAGES: list inbox and sent messages
app.get("/api/messages", auth, async (req, res) => {
  const filter = req.session.role === "admin"
    ? {}
    : {
        $or: [
          { fromId: req.session.userId },
          { toId: req.session.userId }
        ]
      };

  res.json(
    await messages.find(filter).sort({ createdAt: -1 }).limit(300).toArray()
  );
});

// MESSAGES: admin can message NGOs and users.
// Other users can message the admin, or users linked by a donation.
app.post("/api/messages", auth, async (req, res) => {
  const { toId, subject, body } = req.body;
  const recipientId = id(toId);

  const target = recipientId
    ? await users.findOne({
        _id: recipientId,
        status: "active"
      })
    : null;

  const sender = await current(req);

  if (!target || !subject || !body) {
    return res.status(400).json({
      error: "Choose a recipient and enter a subject and message."
    });
  }

  if (req.session.role !== "admin" && target.role !== "admin") {
    const linkedDonation = await donations.findOne({
      $or: [
        {
          ownerId: req.session.userId,
          recipientId: String(recipientId)
        },
        {
          ownerId: String(recipientId),
          recipientId: req.session.userId
        }
      ]
    });

    if (!linkedDonation) {
      return res.status(403).json({
        error: "You can message other users only through a linked donation."
      });
    }
  }

  const message = {
    fromId: req.session.userId,
    fromName: sender.name,
    toId: String(target._id),
    toName: target.name,
    subject: String(subject).slice(0, 160),
    body: String(body).slice(0, 3000),
    createdAt: new Date(),
    read: false
  };

  await messages.insertOne(message);

  await notify(
    String(target._id),
    "New message",
    `${sender.name}: ${message.subject}`
  );

  res.status(201).json(message);
});

// NOTIFICATIONS
app.get("/api/notifications", auth, async (req, res) => {
  const userIds = [req.session.userId];

  if (req.session.role === "admin") {
    userIds.push("admin");
  }

  res.json(
    await notifications.find({ userId: { $in: userIds } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()
  );
});

app.patch("/api/notifications/read", auth, async (req, res) => {
  await notifications.updateMany(
    { userId: req.session.userId },
    { $set: { read: true } }
  );

  res.json({ ok: true });
});

// WASTE TRACKING
app.get("/api/waste", auth, async (req, res) => {
  const filter = req.session.role === "admin"
    ? {}
    : { ownerId: req.session.userId };

  res.json(await waste.find(filter).sort({ createdAt: -1 }).toArray());
});

app.post("/api/waste", auth, roles("shopkeeper"), async (req, res) => {
  const body = req.body;
  const quantity = Number(body.quantity);

  if (
    !body.productName ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    !body.reason
  ) {
    return res.status(400).json({
      error: "Enter the product, quantity and reason."
    });
  }

  const record = {
    ownerId: req.session.userId,
    productName: String(body.productName).slice(0, 120),
    quantity,
    reason: String(body.reason).slice(0, 200),
    notes: String(body.notes || "").slice(0, 1000),
    createdAt: new Date()
  };

  const result = await waste.insertOne(record);

  res.status(201).json({
    ...record,
    id: String(result.insertedId)
  });
});

// REVIEWS
app.get("/api/reviews", auth, async (_req, res) => {
  res.json(
    await reviews.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()
  );
});

app.post("/api/reviews", auth, async (req, res) => {
  const rating = Number(req.body.rating);
  const comment = String(req.body.comment || "").trim();
  const user = await current(req);

  if (
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    !comment
  ) {
    return res.status(400).json({
      error: "Enter a rating from 1 to 5 and a comment."
    });
  }

  const review = {
    userId: req.session.userId,
    name: user.name,
    rating,
    comment: comment.slice(0, 2000),
    createdAt: new Date()
  };

  await reviews.insertOne(review);
  res.status(201).json(review);
});

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Generic error handler
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(400).json({
    error: error.message || "Request failed."
  });
});

// Connect to MongoDB and start server
async function start() {
  await client.connect();

  const db = client.db(DB);

  users = db.collection("users");
  products = db.collection("products");
  offers = db.collection("offers");
  donations = db.collection("donations");
  messages = db.collection("messages");
  notifications = db.collection("notifications");
  waste = db.collection("waste");
  reviews = db.collection("reviews");

  await users.createIndex({ email: 1 }, { unique: true });
  await products.createIndex({ ownerId: 1 });

  // Create the admin account from .env if it does not already exist.
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";

  if (
    email &&
    password.length >= 12 &&
    !(await users.findOne({ email }))
  ) {
    await users.insertOne({
      name: "FreshTrack Admin",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin",
      status: "active",
      createdAt: new Date()
    });

    console.log("FreshTrack admin account created.");
  } else if (!email || password.length < 12) {
    console.log(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in .env to create the admin account."
    );
  }

  app.listen(PORT, () => {
    console.log(`FreshTrack running at http://localhost:${PORT}`);
  });
}

start().catch(error => {
  console.error("Could not start FreshTrack:", error);
  process.exit(1);
});