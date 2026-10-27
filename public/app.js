const $ = id => document.getElementById(id);

let me = null;
let products = [];
let offers = [];
let ngos = [];
let users = [];
let donations = [];
let editingId = null;

const api = async (url, options = {}) => {
  const opts = {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    }
  };

  if (
    opts.body &&
    !(opts.body instanceof FormData) &&
    typeof opts.body !== "string"
  ) {
    opts.body = JSON.stringify(opts.body);
  }

  const response = await fetch(url, opts);
  let data = {};

  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
};

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

const dt = value => {
  if (!value) return "—";

  const date = new Date(String(value).slice(0, 10) + "T00:00:00");

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString();
};

const money = value =>
  "₹" + Number(value || 0).toLocaleString("en-IN");

function toast(message, error = false) {
  const element = $("toast");
  if (!element) {
    console.log(message);
    return;
  }

  element.textContent = message;
  element.className = "toast show" + (error ? " error" : "");

  setTimeout(() => {
    element.className = "toast";
  }, 3000);
}

function nav(id) {
  document.querySelectorAll(".page").forEach(page => {
    page.hidden = page.id !== id;
  });

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === id);
  });

  const titles = {
    shopDashboard: "Shopkeeper overview",
    adminDashboard: "Admin overview",
    inventoryPage: "Inventory",
    offersPage: "Discount offers",
    donationsPage: "Donations",
    messagesPage: "Messages",
    wastePage: "Waste tracking",
    usersPage: "Users & licences",
    ngoPage: "NGO directory",
    reviewsPage: "Community reviews"
  };

  if ($("pageTitle")) {
    $("pageTitle").textContent = titles[id] || "FreshTrack";
  }

  if ($("sidebar")) {
    $("sidebar").classList.remove("open");
  }
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.onclick = () => nav(button.dataset.page);
});

if ($("menuBtn")) {
  $("menuBtn").onclick = () => {
    if ($("sidebar")) $("sidebar").classList.toggle("open");
  };
}

/* PRODUCT EXPIRY STATUS */

function expiryStatus(product) {
  if (!product.expiryDate) {
    return "unknown";
  }

  const expiry = new Date(
    String(product.expiryDate).slice(0, 10) + "T00:00:00"
  );

  if (Number.isNaN(expiry.getTime())) {
    return "unknown";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Math.floor(
    (expiry.getTime() - today.getTime()) / 86400000
  );

  if (days < 0) return "expired";
  if (days <= 7) return "warning";

  return "fresh";
}

function status(product) {
  const quantity = Number(product.quantity ?? 0);

  if (quantity <= 0) {
    return ["Out of stock", "out"];
  }

  const expiry = expiryStatus(product);

  if (expiry === "expired") {
    return ["Expired", "expired"];
  }

  if (expiry === "warning") {
    return ["Expiring soon", "warning"];
  }

  if (expiry === "unknown") {
    return ["Unknown expiry", "warning"];
  }

  return ["Fresh", "fresh"];
}

/* LOGIN AND ROLE DISPLAY */

function setAuth(isLoggedIn) {
  if ($("authView")) $("authView").hidden = isLoggedIn;
  if ($("appView")) $("appView").hidden = !isLoggedIn;
}

function roleUI() {
  if (!me) return;

  const isAdmin = me.role === "admin";
  const isNgo = me.role === "ngo";

  document.querySelectorAll(".shop-only").forEach(element => {
    element.hidden = isAdmin || isNgo;
  });

  document.querySelectorAll(".admin-only").forEach(element => {
    element.hidden = !isAdmin;
  });

  document.querySelectorAll(".ngo-only").forEach(element => {
    element.hidden = !isNgo;
  });

  if ($("userName")) $("userName").textContent = me.name || "User";
  if ($("userRole")) $("userRole").textContent = (me.role || "").toUpperCase();

  if ($("userAvatar")) {
    $("userAvatar").textContent = (me.name || "U")[0].toUpperCase();
  }

  nav(
    isAdmin
      ? "adminDashboard"
      : isNgo
        ? "donationsPage"
        : "shopDashboard"
  );
}

/* DASHBOARD STATISTICS */

function updateShopkeeperStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let fresh = 0;
  let expiring = 0;
  let expired = 0;

  products.forEach(product => {
    if (!product.expiryDate) return;

    const expiry = new Date(
      String(product.expiryDate).slice(0, 10) + "T00:00:00"
    );

    if (Number.isNaN(expiry.getTime())) return;

    const days = Math.floor(
      (expiry.getTime() - today.getTime()) / 86400000
    );

    if (days < 0) {
      expired++;
    } else if (days <= 7) {
      expiring++;
    } else {
      fresh++;
    }
  });

  const setText = (id, value) => {
    document.querySelectorAll(`#${id}`).forEach(element => {
      element.textContent = value;
    });
  };

  setText("shopProductCount", products.length);
  setText("shopLimit", `${products.length} / 100`);
  setText("shopLimitDisplay", `${products.length} / 100`);

  // Update BOTH occurrences in the HTML.
  setText("shopNear", expiring);
  setText("shopExpired", expired);

  setText("shopDonationCount", donations.length);
  setText("itemLimitText", `${products.length} of 100 products used`);
  setText("freshCount", fresh);
  setText("inventoryTotal", products.length);

  if ($("itemLimitBar")) {
    $("itemLimitBar").style.width =
      `${Math.min(products.length, 100)}%`;
  }
}



/* LOAD APPLICATION DATA */

async function load() {
  if (!me) return;

  try {
    products = await api("/api/products");

    if (!Array.isArray(products)) {
      throw new Error("Products data is not in the expected format.");
    }

    [offers, donations] = await Promise.all([
      api("/api/offers"),
      api("/api/donations")
    ]);

    ngos = await api("/api/ngos");

    const [messages, notifications, wastes, reviews] =
      await Promise.all([
        api("/api/messages"),
        api("/api/notifications"),
        api("/api/waste"),
        api("/api/reviews")
      ]);

    if (me.role === "shopkeeper") {
      updateShopkeeperStats();
    }

    if (me.role === "admin") {
      users = await api("/api/admin/users");

      renderAdmin(
        await api("/api/admin/overview"),
        users,
        await api("/api/admin/licences")
      );
    }

    renderProducts();
    renderOffers(offers);
    fillSelects();
    renderDonations();

    if (typeof renderMessages === "function") {
      renderMessages(messages);
    }

    if (typeof renderNotes === "function") {
      renderNotes(notifications);
    }

    if (typeof renderWaste === "function") {
      renderWaste(wastes);
    }

    if (typeof renderReviews === "function") {
      renderReviews(reviews);
    }

    if (me.role === "ngo") {
      const myDonations = donations.filter(
        d => String(d.recipientId) === String(me.id)
      );

      const openRequests = myDonations.filter(d =>
        ["requested", "accepted"].includes(
          String(d.status || "").toLowerCase()
        )
      ).length;

      document.querySelectorAll(
        "#ngoDonationCount strong"
      ).forEach(element => {
        element.textContent = String(myDonations.length);
      });

      document.querySelectorAll(
        "#ngoOpenCount strong"
      ).forEach(element => {
        element.textContent = String(openRequests);
      });
    }
  } catch (error) {
    console.error("FreshTrack loading error:", error);
    toast("Could not fully load FreshTrack: " + error.message, true);
  }
}


/* FORM DROPDOWNS */

function fillSelects() {
  if ($("offerProduct")) {
    $("offerProduct").innerHTML =
      '<option value="">Choose product</option>' +
      products.map(p =>
        `<option value="${esc(p.id || p._id)}">${esc(p.name)} (${esc(p.quantity)})</option>`
      ).join("");
  }

  if ($("donationProduct")) {
    $("donationProduct").innerHTML =
      '<option value="">Choose product</option>' +
      products.map(p =>
        `<option value="${esc(p.id || p._id)}">${esc(p.name)} (${esc(p.quantity)})</option>`
      ).join("");
  }

  if ($("donationNgo")) {
    $("donationNgo").innerHTML =
      '<option value="">Choose NGO</option>' +
      ngos.map(n =>
        `<option value="${esc(n.id || n._id)}">${esc(n.name)} · ${esc(n.email)}</option>`
      ).join("");
  }
}

/* ADMIN DASHBOARD */

function renderAdmin(overview = {}, userList = [], licenceList = []) {
  const setText = (id, value) => {
    if ($(id)) $(id).textContent = value;
  };

  setText("adminShops", overview.shopkeepers ?? 0);
  setText("adminNgos", overview.ngos ?? 0);
  setText("adminPending", overview.pendingLicences ?? 0);
  setText("adminDonations", overview.openDonations ?? 0);
  setText("adminProducts", overview.productCount ?? 0);
  setText("adminMessages", overview.recentMessages ?? 0);

  if ($("usersTable")) {
    $("usersTable").innerHTML = userList.map(user => {
      const id = user.id || user._id;
      const organisation =
        user.shopName || user.organisationName || "—";
      const licence = user.licenceStatus || "not submitted";
      const userStatus = user.status || "active";

      return `
        <tr>
          <td>
            <b>${esc(user.name || "Unnamed user")}</b>
            <small>${esc(user.email || "")}</small>
          </td>
          <td>${esc(user.role || "—")}</td>
          <td>${esc(organisation)}</td>
          <td>${esc(licence)}</td>
          <td>
            <span class="pill ${userStatus === "active" ? "fresh" : "expired"}">
              ${esc(userStatus)}
            </span>
          </td>
          <td>
            ${userStatus === "active"
              ? `<button class="btn ghost" data-user-action="disable" data-user-id="${esc(id)}">Disable</button>`
              : `<button class="btn ghost" data-user-action="enable" data-user-id="${esc(id)}">Enable</button>`
            }
          </td>
        </tr>
      `;
    }).join("") || `
      <tr><td colspan="6">No registered users found.</td></tr>
    `;
  }

  if ($("licenceList")) {
    $("licenceList").innerHTML = licenceList.map(item => `
      <article class="panel">
        <b>${esc(item.name || item.userName || "Licence submission")}</b>
        <p>${esc(item.email || "")}</p>
        <p>Status: ${esc(item.status || "pending")}</p>
      </article>
    `).join("") || `
      <p class="muted">No licence submissions found.</p>
    `;
  }

  if ($("ngoDirectory")) {
    $("ngoDirectory").innerHTML = userList
      .filter(user => user.role === "ngo")
      .map(user => `
        <div class="mini-row">
          <div class="mini-grow">
            <b>${esc(user.name || "NGO")}</b>
            <small>${esc(user.email || "")}</small>
          </div>
          <span class="pill fresh">${esc(user.status || "active")}</span>
        </div>
      `).join("") || '<p class="muted">No registered NGOs found.</p>';
  }
}

/* INVENTORY TABLE AND EXPIRY ALERTS */

function renderProducts() {
  const search = $("searchProducts");
  const query = (search?.value || "").toLowerCase();

  const list = products.filter(product =>
    `${product.name || ""} ${product.category || ""}`
      .toLowerCase()
      .includes(query)
  );

  if ($("inventoryBody")) {
    $("inventoryBody").innerHTML = list.map(product => {
      const [label, cssClass] = status(product);
      const id = product.id || product._id;

      return `
        <tr>
          <td>
            <b>${esc(product.name)}</b>
            <small>${esc(product.category || "Other")}</small>
          </td>
          <td>${esc(product.quantity)}</td>
          <td>${dt(product.expiryDate)}</td>
          <td>${money(product.price)}</td>
          <td><span class="pill ${cssClass}">${esc(label)}</span></td>
          <td>
            <button class="icon-btn" data-edit="${esc(id)}">✎</button>
            <button class="icon-btn danger" data-del="${esc(id)}">×</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  if ($("inventoryEmpty")) {
    $("inventoryEmpty").hidden = list.length > 0;
  }

  if ($("expiryList")) {
  $("expiryList").innerHTML = products
    .filter(product => {
      const label = status(product)[1];
      return label === "warning" || label === "expired";
    })
    .slice(0, 6)
    .map(product => {
      const [label, cssClass] = status(product);

      return `
        <div class="mini-row">
          <span class="dot ${cssClass}"></span>
          <div class="mini-grow">
            <b>${esc(product.name)}</b>
            <small>Expires ${dt(product.expiryDate)}</small>
          </div>
          <span class="pill ${cssClass}">${esc(label)}</span>
        </div>
      `;
    })
    .join("") || '<div class="empty-inline">No urgent expiry alerts.</div>';
}

  document.querySelectorAll("[data-edit]").forEach(button => {
    button.onclick = () => {
      const product = products.find(
        p => String(p.id || p._id) === button.dataset.edit
      );

      if (!product) return;

      editingId = button.dataset.edit;

      const values = [
        product.name || "",
        product.quantity ?? "",
        String(product.expiryDate || "").slice(0, 10),
        product.category || "Other",
        product.price ?? 0,
        product.notes || ""
      ];

      [
        "productName",
        "quantity",
        "expiryDate",
        "category",
        "price",
        "notes"
      ].forEach((id, index) => {
        if ($(id)) $(id).value = values[index];
      });

      if ($("saveProductBtn")) {
        $("saveProductBtn").textContent = "Save changes";
      }

      if ($("cancelEditBtn")) $("cancelEditBtn").hidden = false;

      nav("inventoryPage");
    };
  });

  document.querySelectorAll("[data-del]").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Delete this product?")) return;

      try {
        await api("/api/products/" + button.dataset.del, {
          method: "DELETE"
        });

        await load();
        toast("Product deleted");
      } catch (error) {
        toast(error.message, true);
      }
    };
  });
}

/* ADD AND EDIT PRODUCTS */

if ($("productForm")) {
  $("productForm").onsubmit = async event => {
    event.preventDefault();

    const body = {
      name: $("productName").value,
      quantity: $("quantity").value,
      expiryDate: $("expiryDate").value,
      category: $("category").value,
      price: $("price").value,
      notes: $("notes")?.value || ""
    };

    try {
      await api(
        editingId
          ? "/api/products/" + editingId
          : "/api/products",
        {
          method: editingId ? "PUT" : "POST",
          body
        }
      );

      event.target.reset();
      editingId = null;

      if ($("saveProductBtn")) {
        $("saveProductBtn").textContent = "＋ Add product";
      }

      if ($("cancelEditBtn")) $("cancelEditBtn").hidden = true;

      await load();
      toast("Product saved");
    } catch (error) {
      toast(error.message, true);
    }
  };
}

if ($("cancelEditBtn")) {
  $("cancelEditBtn").onclick = () => {
    editingId = null;

    if ($("productForm")) $("productForm").reset();

    if ($("saveProductBtn")) {
      $("saveProductBtn").textContent = "＋ Add product";
    }

    $("cancelEditBtn").hidden = true;
  };
}

if ($("searchProducts")) {
  $("searchProducts").oninput = renderProducts;
}

/* DONATION REQUESTS */

if ($("donationForm")) {
  $("donationForm").onsubmit = async event => {
    event.preventDefault();

    const productId = $("donationProduct").value;
    const quantity = Number($("donationQuantity").value);
    const ngoId = $("donationNgo").value;
    const notes = $("donationNotes").value.trim();

    if (!productId || !ngoId || quantity < 1) {
      toast("Please select a product, NGO, and valid quantity.", true);
      return;
    }

    const product = products.find(
      p => String(p.id || p._id) === productId
    );

    if (!product) {
      toast("Product not found. Please refresh and try again.", true);
      return;
    }

    if (quantity > Number(product.quantity)) {
      toast("Donation quantity exceeds available stock.", true);
      return;
    }

    try {
      const result = await api("/api/donations", {
        method: "POST",
        body: {
            productId,
            quantity,
            recipientId: ngoId,
            notes
        }
      });

      toast(result.message || "Donation request sent!");

      event.target.reset();
      await load();
    } catch (error) {
      toast("Donation failed: " + error.message, true);
    }
  };
}

/* DISPLAY DONATION REQUESTS */


function renderDonations() {
  const list = $("donationsList");
  if (!list) return;

  const visibleDonations = donations.filter(d => {
    if (me?.role === "ngo") {
      return String(d.recipientId) === String(me.id);
    }

    if (me?.role === "shopkeeper") {
      return String(d.ownerId) === String(me.id);
    }

    return me?.role === "admin";
  });

  list.innerHTML = visibleDonations.map(d => `
    <article class="panel">
      <h3>${esc(d.productName || "Food donation")}</h3>
      <p>Shop: ${esc(d.shopName || "—")}</p>
      <p>Quantity: ${esc(d.quantity)}</p>
      <p>Status: ${esc(d.status || "requested")}</p>
      <p>Notes: ${esc(d.notes || "No additional notes")}</p>
    </article>
  `).join("") || `
    <div class="empty-inline">
      No donation requests found.
    </div>
  `;
}


/* DISCOUNT OFFERS */

function renderOffers(list) {
  if (!$("offersList")) return;

  $("offersList").innerHTML = list.map(offer => `
    <div class="offer-card">
      <div class="offer-mark">
        ${esc(offer.discountPercent)}<small>% OFF</small>
      </div>
      <div class="offer-copy">
        <b>${esc(offer.name)}</b>
        <p>${esc(offer.description || "Limited-time offer")}</p>
      </div>
    </div>
  `).join("") || '<div class="empty-inline">No offers yet.</div>';
}

/* LICENCE SUBMISSION */

if ($("licenceForm")) {
  $("licenceForm").onsubmit = async event => {
    event.preventDefault();

    const file = $("licenceFile")?.files?.[0];

    if (!file) {
      toast("Please select a licence file.", true);
      return;
    }

    const formData = new FormData();
    formData.append("licence", file);

    try {
      const result = await api("/api/licence", {
        method: "POST",
        body: formData
      });

      toast(result.message || "Licence submitted");
      event.target.reset();
    } catch (error) {
      toast(error.message, true);
    }
  };
}

/* REGISTRATION */

if ($("registerForm")) {
  $("registerForm").onsubmit = async event => {
    event.preventDefault();

    try {
      const result = await api("/api/auth/register", {
        method: "POST",
        body: {
          name: $("regName").value,
          email: $("regEmail").value,
          password: $("regPassword").value,
          shopName: $("regShop")?.value || "",
          role: $("regRole").value
        }
      });

      me = result.user;
      roleUI();
      setAuth(true);
      await load();
      toast("Account created");
    } catch (error) {
      toast(error.message, true);
    }
  };
}

/* LOGIN */

if ($("loginForm")) {
  $("loginForm").onsubmit = async event => {
    event.preventDefault();

    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: {
          email: $("loginEmail").value,
          password: $("loginPassword").value
        }
      });

      me = result.user;
      roleUI();
      setAuth(true);
      await load();
      toast("Welcome back");
    } catch (error) {
      toast(error.message, true);
    }
  };
}

/* LOGOUT */

if ($("logoutBtn")) {
  $("logoutBtn").onclick = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });

      me = null;
      products = [];
      offers = [];
      donations = [];
      setAuth(false);
    } catch (error) {
      toast(error.message, true);
    }
  };
}

/* SWITCH LOGIN AND REGISTER PANELS */

if ($("showRegister")) {
  $("showRegister").onclick = () => {
    if ($("loginPane")) $("loginPane").hidden = true;
    if ($("registerPane")) $("registerPane").hidden = false;
  };
}

if ($("showLogin")) {
  $("showLogin").onclick = () => {
    if ($("registerPane")) $("registerPane").hidden = true;
    if ($("loginPane")) $("loginPane").hidden = false;
  };
}

/* REFRESH */

if ($("refreshBtn")) {
  $("refreshBtn").onclick = async () => {
    try {
      await load();
      toast("Refreshed");
    } catch (error) {
      toast(error.message, true);
    }
  };
}

/* RESTORE EXISTING SESSION */

(async () => {
  try {
    const result = await api("/api/me");

    if (result.user) {
      me = result.user;
      roleUI();
      setAuth(true);
      await load();
    } else {
      setAuth(false);
    }
  } catch (error) {
    console.error("Session check failed:", error);
    setAuth(false);
  }
})();