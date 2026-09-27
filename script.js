import {
  isFirebaseConfigured,
  onUserChanged,
  signInGoogle,
  signOutGoogle,
  loadCloudState,
  saveCloudState
} from "./firebase.js";

const STORAGE_KEY = "ledgerpro_data_v1";

let state;
try {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
} catch (error) {
  state = {};
}

if (!Array.isArray(state.customers)) state.customers = [];
if (!Array.isArray(state.suppliers)) state.suppliers = [];
if (!Array.isArray(state.labours)) state.labours = [];

state.customers.forEach(c => {
  if (!Array.isArray(c.purchases)) c.purchases = [];
  if (!Array.isArray(c.payments)) c.payments = [];
});

state.suppliers.forEach(s => {
  if (!Array.isArray(s.purchases)) s.purchases = [];
  if (!Array.isArray(s.payments)) s.payments = [];
});

state.labours.forEach(l => {
  if (!Array.isArray(l.work)) l.work = [];
  if (!Array.isArray(l.payments)) l.payments = [];
});

const $ = (id) => document.getElementById(id);

// Initialize Firebase authentication and cloud synchronization early so that
// a later UI error cannot prevent the Google Sign-In listener from being attached.
initializeFirebaseConnection().catch((error) => {
  console.error("Firebase initialization failed:", error);
  const status = document.getElementById("cloudStatus");
  if (status) {
    status.textContent = "Firebase error";
    status.className = "cloud-status error";
  }
  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = error?.message || "Firebase initialization failed.";
    toast.classList.add("show");
  }
});

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  }).format(Number(value) || 0);
}

function today() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

let currentFirebaseUser = null;
let cloudSyncTimer = null;
let cloudSyncInProgress = false;
let suppressCloudSync = false;

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  if (currentFirebaseUser && !suppressCloudSync && isFirebaseConfigured()) {
    queueCloudSave();
  }
}

function queueCloudSave() {
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(async () => {
    if (!currentFirebaseUser || cloudSyncInProgress || suppressCloudSync) return;

    cloudSyncInProgress = true;
    setCloudStatus("Saving…", "connected");

    try {
      await saveCloudState(currentFirebaseUser.uid, state);
      setCloudStatus("Cloud saved", "connected");
    } catch (error) {
      console.error("Cloud save failed:", error);
      setCloudStatus("Cloud save failed", "error");
      showToast("Cloud save failed. Your local copy is still saved.");
    } finally {
      cloudSyncInProgress = false;
    }
  }, 500);
}

function setCloudStatus(text, className = "") {
  const status = $("cloudStatus");
  status.textContent = text;
  status.className = `cloud-status ${className}`.trim();

  const sidebarTitle = $("sidebarStorageTitle");
  const sidebarText = $("sidebarStorageText");

  if (!currentFirebaseUser) {
    sidebarTitle.textContent = "Cloud-ready";
    sidebarText.textContent = "Sign in with Google to sync your data.";
  } else {
    sidebarTitle.textContent = "Cloud synced";
    sidebarText.textContent = "Your signed-in Google account stores the main copy.";
  }
}

function customerById(id) {
  return state.customers.find(c => c.id === id);
}

function totals(customer) {
  const purchases = customer.purchases.reduce((sum, p) => sum + p.amount, 0);
  const payments = customer.payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    purchases,
    payments,
    balance: purchases - payments
  };
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function setView(view) {
  const target = $(view);
  if (!target) return;

  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  target.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  const titles = {
    dashboard: "Dashboard",
    customers: "Customers",
    purchases: "New Purchase",
    payment: "Receive Payment",
    suppliers: "Suppliers",
    supplierPurchase: "Buy Stock",
    supplierPayment: "Pay Supplier",
    labours: "Labour",
    labourWork: "Add Labour Work",
    labourPayment: "Pay Labour",
    customerDetail: "Customer Account"
  };

  $("pageTitle").textContent = titles[view] || "Dashboard";
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (view === "dashboard") renderDashboard();
  if (view === "customers") renderCustomers();
  if (view === "purchases") populateCustomerSelects();
  if (view === "payment") populateCustomerSelects();
  if (view === "suppliers") renderSuppliers();
  if (view === "supplierPurchase") populateSupplierSelects();
  if (view === "supplierPayment") populateSupplierSelects();
  if (view === "labours") renderLabours();
  if (view === "labourWork") {
    populateLabourSelects();
    updateLabourPreview();
  }
  if (view === "labourPayment") populateLabourSelects();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

$("quickPurchase").addEventListener("click", () => setView("purchases"));
$("backCustomers").addEventListener("click", () => setView("customers"));

$("addCustomerBtn").addEventListener("click", () => {
  $("modal").classList.remove("hidden");
  $("customerName").focus();
});

$("closeModal").addEventListener("click", () => {
  $("modal").classList.add("hidden");
});

$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) $("modal").classList.add("hidden");
});

$("customerForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const name = $("customerName").value.trim();
  const phone = $("customerPhone").value.trim();
  const address = $("customerAddress").value.trim();

  if (!name) return;

  const duplicate = state.customers.some(
    c => c.name.toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    showToast("Customer already exists.");
    return;
  }

  state.customers.push({
    id: crypto.randomUUID(),
    name,
    phone,
    address,
    purchases: [],
    payments: []
  });

  save();
  e.target.reset();
  $("modal").classList.add("hidden");
  renderDashboard();
  renderCustomers();
  populateCustomerSelects();
  showToast("Customer added successfully.");
});



window.editCustomerPayment = function(customerId, paymentId) {
  const customer = customerById(customerId);
  if (!customer) return;

  const payment = customer.payments.find(p => p.id === paymentId);
  if (!payment) return;

  $("editPaymentId").value = payment.id;
  $("editPaymentCustomerId").value = customer.id;
  $("editPaymentDate").value = payment.date;
  $("editPaymentAmount").value = payment.amount;
  $("editPaymentNote").value = payment.note || "";

  $("editPaymentModal").classList.remove("hidden");
};

window.deleteCustomerPayment = function(customerId, paymentId) {
  const customer = customerById(customerId);
  if (!customer) return;

  const index = customer.payments.findIndex(p => p.id === paymentId);
  if (index === -1) return;

  const payment = customer.payments[index];

  if (!confirm(`Delete customer payment of ${money(payment.amount)}?`)) return;

  customer.payments.splice(index, 1);
  save();
  renderDashboard();
  renderCustomers();
  openCustomer(customerId);
  showToast("Customer payment deleted successfully.");
};

$("closeEditPaymentModal").addEventListener("click", () => {
  $("editPaymentModal").classList.add("hidden");
});

$("editPaymentModal").addEventListener("click", (e) => {
  if (e.target === $("editPaymentModal")) {
    $("editPaymentModal").classList.add("hidden");
  }
});

$("editPaymentForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const customer = customerById($("editPaymentCustomerId").value);
  if (!customer) return;

  const payment = customer.payments.find(
    p => p.id === $("editPaymentId").value
  );
  if (!payment) return;

  const amount = Number($("editPaymentAmount").value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return showToast("Enter a valid payment amount.");
  }

  payment.date = $("editPaymentDate").value;
  payment.amount = amount;
  payment.note = $("editPaymentNote").value.trim();

  save();
  $("editPaymentModal").classList.add("hidden");
  renderDashboard();
  renderCustomers();
  openCustomer(customer.id);
  showToast("Customer payment updated successfully.");
});



function labourById(id) {
  return state.labours.find(l => l.id === id);
}

function labourTotals(labour) {
  const work = labour.work.reduce((sum, w) => sum + w.total, 0);
  const payments = labour.payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    work,
    payments,
    payable: work - payments
  };
}

function calculateLabourWork(dailyWage, overtimeHours, overtimeRate, unloadCharge) {
  const overtime = overtimeHours * overtimeRate;
  return {
    overtime,
    unload: unloadCharge,
    total: dailyWage + overtime + unloadCharge
  };
}

function populateLabourSelects() {
  const options = state.labours.length
    ? `<option value="">Select labour</option>` +
      state.labours.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("")
    : `<option value="">No labour records yet</option>`;

  $("labourWorkLabour").innerHTML = options;
  $("labourPaymentLabour").innerHTML = options;
}

$("addLabourBtn").addEventListener("click", () => {
  $("labourModal").classList.remove("hidden");
  $("labourName").focus();
});

$("closeLabourModal").addEventListener("click", () => {
  $("labourModal").classList.add("hidden");
});

$("labourModal").addEventListener("click", (e) => {
  if (e.target === $("labourModal")) $("labourModal").classList.add("hidden");
});

$("labourForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const name = $("labourName").value.trim();
  const phone = $("labourPhone").value.trim();
  const address = $("labourAddress").value.trim();

  if (state.labours.some(l => l.name.toLowerCase() === name.toLowerCase())) {
    showToast("Labour record already exists.");
    return;
  }

  state.labours.push({
    id: crypto.randomUUID(),
    name,
    phone,
    address,
    work: [],
    payments: []
  });

  save();
  e.target.reset();
  $("labourModal").classList.add("hidden");
  populateLabourSelects();
  renderLabours();
  showToast("Labour added successfully.");
});

function updateLabourPreview() {
  const daily = Number($("labourDailyWage").value) || 0;
  const overtimeHours = Number($("labourOvertimeHours").value) || 0;
  const overtimeRate = Number($("labourOvertimeRate").value) || 0;
  const unload = Number($("labourUnloadCharge").value) || 0;
  const calc = calculateLabourWork(daily, overtimeHours, overtimeRate, unload);

  $("labourDailyPreview").textContent = money(daily);
  $("labourOvertimePreview").textContent = money(calc.overtime);
  $("labourUnloadPreview").textContent = money(calc.unload);
  $("labourTotalPreview").textContent = money(calc.total);
}

["labourDailyWage", "labourOvertimeHours", "labourOvertimeRate", "labourUnloadCharge"]
  .forEach(id => $(id).addEventListener("input", updateLabourPreview));

$("labourWorkForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const labour = labourById($("labourWorkLabour").value);
  if (!labour) return showToast("Please select a labourer.");

  const daily = Number($("labourDailyWage").value) || 0;
  const overtimeHours = Number($("labourOvertimeHours").value) || 0;
  const overtimeRate = Number($("labourOvertimeRate").value) || 0;
  const unload = Number($("labourUnloadCharge").value) || 0;
  const calc = calculateLabourWork(daily, overtimeHours, overtimeRate, unload);

  labour.work.push({
    id: crypto.randomUUID(),
    date: $("labourWorkDate").value,
    regularHours: Number($("labourRegularHours").value) || 0,
    dailyWage: daily,
    overtimeHours,
    overtimeRate,
    overtimeAmount: calc.overtime,
    unloadCharge: unload,
    note: $("labourWorkNote").value.trim(),
    total: calc.total
  });

  save();
  e.target.reset();
  $("labourWorkDate").value = today();
  $("labourRegularHours").value = 9;
  $("labourDailyWage").value = 500;
  $("labourOvertimeHours").value = 0;
  $("labourOvertimeRate").value = 50;
  $("labourUnloadCharge").value = 0;
  updateLabourPreview();
  renderLabours();
  showToast("Labour work saved.");
});

$("labourPaymentForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const labour = labourById($("labourPaymentLabour").value);
  if (!labour) return showToast("Please select a labourer.");

  const amount = Number($("labourPaymentAmount").value);
  const payable = labourTotals(labour).payable;

  if (amount <= 0) return showToast("Enter a valid payment amount.");

  if (amount > payable && payable > 0) {
    const proceed = confirm(
      `This payment is greater than the current outstanding amount of ${money(payable)}. Continue?`
    );
    if (!proceed) return;
  }

  labour.payments.push({
    id: crypto.randomUUID(),
    date: $("labourPaymentDate").value,
    amount,
    note: $("labourPaymentNote").value.trim()
  });

  save();
  e.target.reset();
  $("labourPaymentDate").value = today();
  renderLabours();
  showToast("Labour payment recorded.");
});

$("labourSearch").addEventListener("input", renderLabours);

function renderLabours() {
  const query = $("labourSearch").value.trim().toLowerCase();

  const filtered = state.labours.filter(l =>
    l.name.toLowerCase().includes(query) ||
    l.phone.toLowerCase().includes(query)
  );

  $("labourGrid").innerHTML = filtered.length
    ? filtered.map(l => {
      const t = labourTotals(l);
      return `
        <article class="customer-card">
          <h3>${escapeHtml(l.name)}</h3>
          <div class="phone">${escapeHtml(l.phone || "No phone number")}</div>
          <div class="supplier-balance">
            <span>Amount Payable</span>
            <strong>${money(Math.max(t.payable, 0))}</strong>
          </div>
          <div class="card-actions">
            <button class="secondary" onclick="openLabour('${l.id}')">View Account</button>
            <button class="secondary" onclick="quickLabourPayment('${l.id}')">Pay</button>
          </div>
        </article>
      `;
    }).join("")
    : `<div class="panel"><p>No labour records found. Add your first labourer.</p></div>`;
}

window.quickLabourPayment = function(id) {
  setView("labourPayment");
  $("labourPaymentLabour").value = id;
};

window.openLabour = function(id) {
  const labour = labourById(id);
  if (!labour) return;

  const t = labourTotals(labour);

  const workRows = labour.work.map(w => `
    <tr>
      <td>${formatDate(w.date)}</td>
      <td>${w.regularHours} hrs</td>
      <td>${money(w.dailyWage)}</td>
      <td>${w.overtimeHours} hrs × ${money(w.overtimeRate)}</td>
      <td>${money(w.overtimeAmount)}</td>
      <td>${money(w.unloadCharge)}</td>
      <td>${money(w.total)}</td>
      <td class="history-actions">
        <button class="secondary" onclick="editLabourWork('${labour.id}', '${w.id}')">Edit</button>
        <button class="danger-btn" onclick="deleteLabourWork('${labour.id}', '${w.id}')">Delete</button>
      </td>
    </tr>
  `).join("");

  const paymentRows = labour.payments.map(p => `
    <tr>
      <td>${formatDate(p.date)}</td>
      <td>Weekly / Labour Payment</td>
      <td>${escapeHtml(p.note || "-")}</td>
      <td class="amount negative">-${money(p.amount)}</td>
      <td class="history-actions">
        <button class="secondary" onclick="editLabourPayment('${labour.id}', '${p.id}')">Edit</button>
        <button class="danger-btn" onclick="deleteLabourPayment('${labour.id}', '${p.id}')">Delete</button>
      </td>
    </tr>
  `).join("");

  $("customerDetail").classList.add("active");
  document.querySelectorAll(".view").forEach(v => {
    if (v.id !== "customerDetail") v.classList.remove("active");
  });
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  $("pageTitle").textContent = "Labour Account";

  $("detailContent").innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(labour.name)}</h2>
      <p>${escapeHtml(labour.phone || "No phone")} ${labour.address ? " · " + escapeHtml(labour.address) : ""}</p>
    </div>

    <div class="detail-summary">
      <div class="detail-stat">
        <span>Total Labour Cost</span>
        <strong>${money(t.work)}</strong>
      </div>
      <div class="detail-stat">
        <span>Total Paid</span>
        <strong>${money(t.payments)}</strong>
      </div>
      <div class="detail-stat">
        <span>Outstanding</span>
        <strong>${money(Math.max(t.payable, 0))}</strong>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Daily Labour Records</h2>
          <p>Daily wage + overtime + unloading/extra charge.</p>
        </div>
      </div>
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th><th>Regular</th><th>Daily Wage</th><th>Overtime</th>
            <th>OT Amount</th><th>Unloading</th><th>Total</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${workRows || `<tr><td colspan="8">No labour work recorded yet.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="panel" style="margin-top:20px">
      <div class="panel-head">
        <div>
          <h2>Payment History</h2>
          <p>Weekly or partial payments made to this labourer.</p>
        </div>
      </div>
      <table class="history-table">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Note</th><th>Amount</th><th>Actions</th></tr>
        </thead>
        <tbody>${paymentRows || `<tr><td colspan="5">No payments yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  window.scrollTo({ top: 0, behavior: "smooth" });
};

function updateEditLabourPreview() {
  const daily = Number($("editLabourDailyWage").value) || 0;
  const overtimeHours = Number($("editLabourOvertimeHours").value) || 0;
  const overtimeRate = Number($("editLabourOvertimeRate").value) || 0;
  const unload = Number($("editLabourUnloadCharge").value) || 0;
  const calc = calculateLabourWork(daily, overtimeHours, overtimeRate, unload);

  $("editLabourDailyPreview").textContent = money(daily);
  $("editLabourOvertimePreview").textContent = money(calc.overtime);
  $("editLabourUnloadPreview").textContent = money(calc.unload);
  $("editLabourTotalPreview").textContent = money(calc.total);
}

["editLabourDailyWage", "editLabourOvertimeHours", "editLabourOvertimeRate", "editLabourUnloadCharge"]
  .forEach(id => $(id).addEventListener("input", updateEditLabourPreview));

window.editLabourWork = function(labourId, workId) {
  const labour = labourById(labourId);
  if (!labour) return;

  const work = labour.work.find(w => w.id === workId);
  if (!work) return;

  $("editLabourWorkId").value = work.id;
  $("editLabourWorkLabourId").value = labour.id;
  $("editLabourWorkDate").value = work.date;
  $("editLabourRegularHours").value = work.regularHours;
  $("editLabourDailyWage").value = work.dailyWage;
  $("editLabourOvertimeHours").value = work.overtimeHours;
  $("editLabourOvertimeRate").value = work.overtimeRate;
  $("editLabourUnloadCharge").value = work.unloadCharge;
  $("editLabourWorkNote").value = work.note || "";
  updateEditLabourPreview();

  $("editLabourWorkModal").classList.remove("hidden");
};

window.deleteLabourWork = function(labourId, workId) {
  const labour = labourById(labourId);
  if (!labour) return;

  const index = labour.work.findIndex(w => w.id === workId);
  if (index === -1) return;

  const work = labour.work[index];
  if (!confirm(`Delete this labour work record of ${money(work.total)}?`)) return;

  labour.work.splice(index, 1);
  save();
  renderLabours();
  openLabour(labourId);
  showToast("Labour work deleted.");
};

$("closeEditLabourWorkModal").addEventListener("click", () => {
  $("editLabourWorkModal").classList.add("hidden");
});

$("editLabourWorkModal").addEventListener("click", (e) => {
  if (e.target === $("editLabourWorkModal")) $("editLabourWorkModal").classList.add("hidden");
});

$("editLabourWorkForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const labour = labourById($("editLabourWorkLabourId").value);
  if (!labour) return;

  const work = labour.work.find(w => w.id === $("editLabourWorkId").value);
  if (!work) return;

  const daily = Number($("editLabourDailyWage").value) || 0;
  const overtimeHours = Number($("editLabourOvertimeHours").value) || 0;
  const overtimeRate = Number($("editLabourOvertimeRate").value) || 0;
  const unload = Number($("editLabourUnloadCharge").value) || 0;
  const calc = calculateLabourWork(daily, overtimeHours, overtimeRate, unload);

  work.date = $("editLabourWorkDate").value;
  work.regularHours = Number($("editLabourRegularHours").value) || 0;
  work.dailyWage = daily;
  work.overtimeHours = overtimeHours;
  work.overtimeRate = overtimeRate;
  work.overtimeAmount = calc.overtime;
  work.unloadCharge = unload;
  work.note = $("editLabourWorkNote").value.trim();
  work.total = calc.total;

  save();
  $("editLabourWorkModal").classList.add("hidden");
  renderLabours();
  openLabour(labour.id);
  showToast("Labour work updated.");
});

window.editLabourPayment = function(labourId, paymentId) {
  const labour = labourById(labourId);
  if (!labour) return;

  const payment = labour.payments.find(p => p.id === paymentId);
  if (!payment) return;

  $("editLabourPaymentId").value = payment.id;
  $("editLabourPaymentLabourId").value = labour.id;
  $("editLabourPaymentDate").value = payment.date;
  $("editLabourPaymentAmount").value = payment.amount;
  $("editLabourPaymentNote").value = payment.note || "";

  $("editLabourPaymentModal").classList.remove("hidden");
};

window.deleteLabourPayment = function(labourId, paymentId) {
  const labour = labourById(labourId);
  if (!labour) return;

  const index = labour.payments.findIndex(p => p.id === paymentId);
  if (index === -1) return;

  const payment = labour.payments[index];
  if (!confirm(`Delete labour payment of ${money(payment.amount)}?`)) return;

  labour.payments.splice(index, 1);
  save();
  renderLabours();
  openLabour(labourId);
  showToast("Labour payment deleted.");
};

$("closeEditLabourPaymentModal").addEventListener("click", () => {
  $("editLabourPaymentModal").classList.add("hidden");
});

$("editLabourPaymentModal").addEventListener("click", (e) => {
  if (e.target === $("editLabourPaymentModal")) $("editLabourPaymentModal").classList.add("hidden");
});

$("editLabourPaymentForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const labour = labourById($("editLabourPaymentLabourId").value);
  if (!labour) return;

  const payment = labour.payments.find(p => p.id === $("editLabourPaymentId").value);
  if (!payment) return;

  const amount = Number($("editLabourPaymentAmount").value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return showToast("Enter a valid payment amount.");
  }

  payment.date = $("editLabourPaymentDate").value;
  payment.amount = amount;
  payment.note = $("editLabourPaymentNote").value.trim();

  save();
  $("editLabourPaymentModal").classList.add("hidden");
  renderLabours();
  openLabour(labour.id);
  showToast("Labour payment updated.");
});


function supplierById(id) {
  return state.suppliers.find(s => s.id === id);
}

function supplierTotals(supplier) {
  const purchases = supplier.purchases.reduce((sum, p) => sum + p.amount, 0);
  const payments = supplier.payments.reduce((sum, p) => sum + p.amount, 0);
  return {
    purchases,
    payments,
    payable: purchases - payments
  };
}

function populateSupplierSelects() {
  const options = state.suppliers.length
    ? `<option value="">Select supplier</option>` +
      state.suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")
    : `<option value="">No suppliers yet</option>`;

  $("supplierPurchaseSupplier").innerHTML = options;
  $("supplierPaymentSupplier").innerHTML = options;
}

$("addSupplierBtn").addEventListener("click", () => {
  $("supplierModal").classList.remove("hidden");
  $("supplierName").focus();
});

$("closeSupplierModal").addEventListener("click", () => {
  $("supplierModal").classList.add("hidden");
});

$("supplierModal").addEventListener("click", (e) => {
  if (e.target === $("supplierModal")) $("supplierModal").classList.add("hidden");
});

$("supplierForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const name = $("supplierName").value.trim();
  const phone = $("supplierPhone").value.trim();
  const address = $("supplierAddress").value.trim();

  const duplicate = state.suppliers.some(
    s => s.name.toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    showToast("Supplier already exists.");
    return;
  }

  state.suppliers.push({
    id: crypto.randomUUID(),
    name,
    phone,
    address,
    purchases: [],
    payments: []
  });

  save();
  e.target.reset();
  $("supplierModal").classList.add("hidden");
  populateSupplierSelects();
  renderSuppliers();
  showToast("Supplier added successfully.");
});

$("supplierPurchaseQuantity").addEventListener("input", updateSupplierPurchaseAmount);
$("supplierPurchaseRate").addEventListener("input", updateSupplierPurchaseAmount);

function updateSupplierPurchaseAmount() {
  const quantity = Number($("supplierPurchaseQuantity").value) || 0;
  const rate = Number($("supplierPurchaseRate").value) || 0;
  $("supplierPurchaseAmount").textContent = money(quantity * rate);
}

$("supplierPurchaseForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const supplier = supplierById($("supplierPurchaseSupplier").value);
  if (!supplier) return showToast("Please select a supplier.");

  const quantity = Number($("supplierPurchaseQuantity").value);
  const rate = Number($("supplierPurchaseRate").value);
  const amount = quantity * rate;
  const paid = Number($("supplierPurchasePaid").value) || 0;

  if (paid > amount) {
    return showToast("Amount paid cannot be greater than the purchase amount.");
  }

  const purchaseRecord = {
    id: crypto.randomUUID(),
    date: $("supplierPurchaseDate").value,
    product: $("supplierPurchaseProduct").value.trim(),
    quantity,
    unit: $("supplierPurchaseUnit").value.trim() || "kg",
    rate,
    amount
  };

  supplier.purchases.push(purchaseRecord);

  if (paid > 0) {
    supplier.payments.push({
      id: crypto.randomUUID(),
      linkedPurchaseId: purchaseRecord.id,
      date: $("supplierPurchaseDate").value,
      amount: paid,
      note: "Payment for stock purchase"
    });
  }

  save();
  e.target.reset();
  $("supplierPurchaseDate").value = today();
  $("supplierPurchaseUnit").value = "kg";
  $("supplierPurchasePaid").value = "0";
  updateSupplierPurchaseAmount();
  renderDashboard();
  renderSuppliers();
  showToast("Stock purchase saved successfully.");
});

$("supplierPaymentForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const supplier = supplierById($("supplierPaymentSupplier").value);
  if (!supplier) return showToast("Please select a supplier.");

  const amount = Number($("supplierPaymentAmount").value);
  const payable = supplierTotals(supplier).payable;

  if (amount <= 0) return showToast("Enter a valid payment amount.");

  if (amount > payable && payable > 0) {
    const proceed = confirm(
      `This payment is greater than the current amount payable of ${money(payable)}. Continue?`
    );
    if (!proceed) return;
  }

  supplier.payments.push({
    id: crypto.randomUUID(),
    date: $("supplierPaymentDate").value,
    amount,
    note: $("supplierPaymentNote").value.trim()
  });

  save();
  e.target.reset();
  $("supplierPaymentDate").value = today();
  renderSuppliers();
  showToast("Supplier payment recorded.");
});

$("supplierSearch").addEventListener("input", renderSuppliers);

function renderSuppliers() {
  const query = $("supplierSearch").value.trim().toLowerCase();

  const filtered = state.suppliers.filter(s =>
    s.name.toLowerCase().includes(query) ||
    s.phone.toLowerCase().includes(query)
  );

  $("supplierGrid").innerHTML = filtered.length
    ? filtered.map(s => {
      const t = supplierTotals(s);
      return `
        <article class="customer-card">
          <h3>${escapeHtml(s.name)}</h3>
          <div class="phone">${escapeHtml(s.phone || "No phone number")}</div>
          <div class="supplier-balance">
            <span>Amount Payable</span>
            <strong>${money(Math.max(t.payable, 0))}</strong>
          </div>
          <div class="card-actions">
            <button class="secondary" onclick="openSupplier('${s.id}')">View Account</button>
            <button class="secondary" onclick="quickSupplierPayment('${s.id}')">Pay</button>
          </div>
        </article>
      `;
    }).join("")
    : `<div class="panel"><p>No suppliers found. Add your first supplier.</p></div>`;
}

window.quickSupplierPayment = function(id) {
  setView("supplierPayment");
  $("supplierPaymentSupplier").value = id;
};

window.openSupplier = function(id) {
  const supplier = supplierById(id);
  if (!supplier) return;

  const t = supplierTotals(supplier);

  const purchaseRows = supplier.purchases.map(p => `
    <tr>
      <td>${formatDate(p.date)}</td>
      <td>${escapeHtml(p.product)}</td>
      <td>${p.quantity} ${escapeHtml(p.unit)}</td>
      <td>${money(p.rate)}</td>
      <td>${money(p.amount)}</td>
      <td class="history-actions">
        <button class="secondary" onclick="editSupplierPurchase('${supplier.id}', '${p.id}')">Edit</button>
        <button class="danger-btn" onclick="deleteSupplierPurchase('${supplier.id}', '${p.id}')">Delete</button>
      </td>
    </tr>
  `).join("");

  const paymentRows = supplier.payments.map(p => `
    <tr>
      <td>${formatDate(p.date)}</td>
      <td>Payment</td>
      <td>${escapeHtml(p.note || "-")}</td>
      <td class="amount negative">-${money(p.amount)}</td>
      <td class="history-actions">
        <button class="secondary" onclick="editSupplierPayment('${supplier.id}', '${p.id}')">Edit</button>
        <button class="danger-btn" onclick="deleteSupplierPayment('${supplier.id}', '${p.id}')">Delete</button>
      </td>
    </tr>
  `).join("");

  $("customerDetail").classList.add("active");
  document.querySelectorAll(".view").forEach(v => {
    if (v.id !== "customerDetail") v.classList.remove("active");
  });
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  $("pageTitle").textContent = "Supplier Account";

  $("detailContent").innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(supplier.name)}</h2>
      <p>${escapeHtml(supplier.phone || "No phone")} ${supplier.address ? " · " + escapeHtml(supplier.address) : ""}</p>
    </div>

    <div class="detail-summary">
      <div class="detail-stat">
        <span>Total Stock Purchases</span>
        <strong>${money(t.purchases)}</strong>
      </div>
      <div class="detail-stat">
        <span>Total Paid to Seller</span>
        <strong>${money(t.payments)}</strong>
      </div>
      <div class="detail-stat">
        <span>Amount Payable</span>
        <strong>${money(Math.max(t.payable, 0))}</strong>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Stock Purchase History</h2>
          <p>Quantity × rate = total amount payable for each purchase.</p>
        </div>
      </div>
      <table class="history-table">
        <thead>
          <tr><th>Date</th><th>Product</th><th>Quantity</th><th>Rate</th><th>Total</th><th>Actions</th></tr>
        </thead>
        <tbody>${purchaseRows || `<tr><td colspan="6">No stock purchases yet.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Payments to Seller</h2>
          <p>Delete or edit a payment if it was entered incorrectly.</p>
        </div>
      </div>
      <table class="history-table">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Note</th><th>Amount</th><th>Actions</th></tr>
        </thead>
        <tbody>${paymentRows || `<tr><td colspan="6">No payments yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  window.scrollTo({ top: 0, behavior: "smooth" });
};


window.editSupplierPurchase = function(supplierId, purchaseId) {
  const supplier = supplierById(supplierId);
  if (!supplier) return;

  const purchase = supplier.purchases.find(p => p.id === purchaseId);
  if (!purchase) return;

  $("editSupplierPurchaseId").value = purchase.id;
  $("editSupplierPurchaseSupplierId").value = supplier.id;
  $("editSupplierPurchaseDate").value = purchase.date;
  $("editSupplierPurchaseProduct").value = purchase.product;
  $("editSupplierPurchaseQuantity").value = purchase.quantity;
  $("editSupplierPurchaseUnit").value = purchase.unit || "kg";
  $("editSupplierPurchaseRate").value = purchase.rate;
  updateEditSupplierPurchaseAmount();
  $("editSupplierPurchaseModal").classList.remove("hidden");
};

window.deleteSupplierPurchase = function(supplierId, purchaseId) {
  const supplier = supplierById(supplierId);
  if (!supplier) return;

  const index = supplier.purchases.findIndex(p => p.id === purchaseId);
  if (index === -1) return;

  const purchase = supplier.purchases[index];
  if (!confirm(`Delete stock purchase of ${purchase.quantity} ${purchase.unit} ${purchase.product} for ${money(purchase.amount)}?`)) return;

  supplier.purchases.splice(index, 1);

  // If this purchase had a payment recorded at the time of purchase, remove only that linked payment.
  supplier.payments = supplier.payments.filter(p => p.linkedPurchaseId !== purchaseId);

  save();
  renderSuppliers();
  openSupplier(supplierId);
  showToast("Stock purchase deleted successfully.");
};

function updateEditSupplierPurchaseAmount() {
  const quantity = Number($("editSupplierPurchaseQuantity").value) || 0;
  const rate = Number($("editSupplierPurchaseRate").value) || 0;
  $("editSupplierPurchaseAmount").textContent = money(quantity * rate);
}

["editSupplierPurchaseQuantity", "editSupplierPurchaseRate"]
  .forEach(id => $(id).addEventListener("input", updateEditSupplierPurchaseAmount));

$("closeEditSupplierPurchaseModal").addEventListener("click", () => {
  $("editSupplierPurchaseModal").classList.add("hidden");
});

$("editSupplierPurchaseModal").addEventListener("click", (e) => {
  if (e.target === $("editSupplierPurchaseModal")) {
    $("editSupplierPurchaseModal").classList.add("hidden");
  }
});

$("editSupplierPurchaseForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const supplier = supplierById($("editSupplierPurchaseSupplierId").value);
  if (!supplier) return;

  const purchase = supplier.purchases.find(p => p.id === $("editSupplierPurchaseId").value);
  if (!purchase) return;

  const quantity = Number($("editSupplierPurchaseQuantity").value);
  const rate = Number($("editSupplierPurchaseRate").value);

  purchase.date = $("editSupplierPurchaseDate").value;
  purchase.product = $("editSupplierPurchaseProduct").value.trim();
  purchase.quantity = quantity;
  purchase.unit = $("editSupplierPurchaseUnit").value.trim() || "kg";
  purchase.rate = rate;
  purchase.amount = quantity * rate;

  // Keep a payment linked to this stock purchase on the same date when one exists.
  const linkedPayment = supplier.payments.find(p => p.linkedPurchaseId === purchase.id);
  if (linkedPayment) linkedPayment.date = purchase.date;

  save();
  $("editSupplierPurchaseModal").classList.add("hidden");
  renderSuppliers();
  openSupplier(supplier.id);
  showToast("Stock purchase updated successfully.");
});

window.editSupplierPayment = function(supplierId, paymentId) {
  const supplier = supplierById(supplierId);
  if (!supplier) return;
  const payment = supplier.payments.find(p => p.id === paymentId);
  if (!payment) return;

  const newAmount = prompt("Enter corrected payment amount:", payment.amount);
  if (newAmount === null) return;

  const amount = Number(newAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Enter a valid payment amount.");
    return;
  }

  const newDate = prompt("Enter payment date (YYYY-MM-DD):", payment.date);
  if (newDate === null) return;

  const newNote = prompt("Enter payment note:", payment.note || "");
  if (newNote === null) return;

  payment.amount = amount;
  payment.date = newDate;
  payment.note = newNote;

  save();
  renderSuppliers();
  openSupplier(supplierId);
  showToast("Supplier payment updated.");
};

window.deleteSupplierPayment = function(supplierId, paymentId) {
  const supplier = supplierById(supplierId);
  if (!supplier) return;

  const index = supplier.payments.findIndex(p => p.id === paymentId);
  if (index === -1) return;

  const payment = supplier.payments[index];
  if (!confirm(`Delete supplier payment of ${money(payment.amount)}?`)) return;

  supplier.payments.splice(index, 1);
  save();
  renderSuppliers();
  openSupplier(supplierId);
  showToast("Supplier payment deleted.");
};


function populateCustomerSelects() {
  const options = state.customers.length
    ? `<option value="">Select customer</option>` +
      state.customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")
    : `<option value="">No customers yet</option>`;

  $("purchaseCustomer").innerHTML = options;
  $("paymentCustomer").innerHTML = options;
}

$("purchaseQuantity").addEventListener("input", updatePurchaseAmount);
$("purchaseRate").addEventListener("input", updatePurchaseAmount);

function updatePurchaseAmount() {
  const quantity = Number($("purchaseQuantity").value) || 0;
  const rate = Number($("purchaseRate").value) || 0;
  $("purchaseAmount").textContent = money(quantity * rate);
}

$("purchaseForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const customer = customerById($("purchaseCustomer").value);
  if (!customer) return showToast("Please select a customer.");

  const quantity = Number($("purchaseQuantity").value);
  const rate = Number($("purchaseRate").value);
  const amount = quantity * rate;

  customer.purchases.push({
    id: crypto.randomUUID(),
    date: $("purchaseDate").value,
    product: $("purchaseProduct").value.trim(),
    quantity,
    unit: $("purchaseUnit").value.trim() || "unit",
    rate,
    amount
  });

  save();
  e.target.reset();
  $("purchaseDate").value = today();
  $("purchaseUnit").value = "kg";
  updatePurchaseAmount();
  renderDashboard();
  showToast("Purchase saved successfully.");
});

$("paymentForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const customer = customerById($("paymentCustomer").value);
  if (!customer) return showToast("Please select a customer.");

  const amount = Number($("paymentAmount").value);
  const currentBalance = totals(customer).balance;

  if (amount <= 0) return showToast("Enter a valid payment amount.");

  if (amount > currentBalance && currentBalance > 0) {
    const proceed = confirm(
      `This payment is greater than the current outstanding balance of ${money(currentBalance)}. Continue?`
    );
    if (!proceed) return;
  }

  customer.payments.push({
    id: crypto.randomUUID(),
    date: $("paymentDate").value,
    amount,
    note: $("paymentNote").value.trim()
  });

  save();
  e.target.reset();
  $("paymentDate").value = today();
  renderDashboard();
  showToast("Payment recorded successfully.");
});

$("customerSearch").addEventListener("input", renderCustomers);

function renderDashboard() {
  const totalCustomers = state.customers.length;
  let purchases = 0;
  let received = 0;
  let outstanding = 0;

  state.customers.forEach(c => {
    const t = totals(c);
    purchases += t.purchases;
    received += t.payments;
    outstanding += Math.max(t.balance, 0);
  });

  $("statCustomers").textContent = totalCustomers;
  $("statPurchases").textContent = money(purchases);
  $("statReceived").textContent = money(received);
  $("statOutstanding").textContent = money(outstanding);

  const events = [];

  state.customers.forEach(c => {
    c.purchases.forEach(p => {
      events.push({
        date: p.date,
        customer: c.name,
        type: "Purchase",
        description: p.product,
        amount: p.amount
      });
    });

    c.payments.forEach(p => {
      events.push({
        date: p.date,
        customer: c.name,
        type: "Payment",
        description: p.note || "Payment received",
        amount: p.amount
      });
    });
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  const recent = events.slice(0, 8);
  $("recentTransactions").classList.toggle("empty", recent.length === 0);
  $("recentTransactions").innerHTML = recent.length
    ? recent.map(e => `
      <div class="transaction-item">
        <div>
          <strong>${escapeHtml(e.customer)}</strong><br>
          <small>${escapeHtml(e.type)} · ${escapeHtml(e.description)} · ${formatDate(e.date)}</small>
        </div>
        <span class="amount ${e.type === "Payment" ? "negative" : "positive"}">
          ${e.type === "Payment" ? "-" : "+"}${money(e.amount)}
        </span>
      </div>
    `).join("")
    : "No transactions yet.";

  const outstandingCustomers = state.customers
    .map(c => ({ c, t: totals(c) }))
    .filter(x => x.t.balance > 0)
    .sort((a, b) => b.t.balance - a.t.balance);

  $("outstandingList").classList.toggle("empty", outstandingCustomers.length === 0);
  $("outstandingList").innerHTML = outstandingCustomers.length
    ? outstandingCustomers.slice(0, 8).map(({c, t}) => `
      <div class="outstanding-item">
        <div>
          <strong>${escapeHtml(c.name)}</strong><br>
          <small>Outstanding</small>
        </div>
        <span class="amount positive">${money(t.balance)}</span>
      </div>
    `).join("")
    : "No outstanding balances.";
}

function renderCustomers() {
  const query = $("customerSearch").value.trim().toLowerCase();

  const filtered = state.customers.filter(c =>
    c.name.toLowerCase().includes(query) ||
    c.phone.toLowerCase().includes(query)
  );

  $("customerGrid").innerHTML = filtered.length
    ? filtered.map(c => {
      const t = totals(c);
      return `
        <article class="customer-card">
          <h3>${escapeHtml(c.name)}</h3>
          <div class="phone">${escapeHtml(c.phone || "No phone number")}</div>
          <div class="balance">
            <span>Outstanding Balance</span>
            <strong>${money(Math.max(t.balance, 0))}</strong>
          </div>
          <div class="card-actions">
            <button class="secondary" onclick="openCustomer('${c.id}')">View Account</button>
            <button class="secondary" onclick="quickPayment('${c.id}')">Payment</button>
          </div>
        </article>
      `;
    }).join("")
    : `<div class="panel"><p>No customers found. Add your first customer.</p></div>`;
}

window.openCustomer = function(id) {
  const customer = customerById(id);
  if (!customer) return;

  const t = totals(customer);

  const purchases = customer.purchases
    .map(p => `
      <tr>
        <td>${formatDate(p.date)}</td>
        <td>${escapeHtml(p.product)}</td>
        <td>${p.quantity} ${escapeHtml(p.unit)}</td>
        <td>${money(p.rate)}</td>
        <td>${money(p.amount)}</td>
        <td class="history-actions">
          <button class="secondary" onclick="editPurchase('${customer.id}', '${p.id}')">Edit</button>
          <button class="danger-btn" onclick="deletePurchase('${customer.id}', '${p.id}')">Delete</button>
        </td>
      </tr>
    `).join("");

  const payments = customer.payments
    .map(p => `
      <tr>
        <td>${formatDate(p.date)}</td>
        <td>Payment</td>
        <td>${escapeHtml(p.note || "-")}</td>
        <td>-</td>
        <td class="amount negative">-${money(p.amount)}</td>
        <td class="history-actions">
          <button class="secondary" onclick="editCustomerPayment('${customer.id}', '${p.id}')">Edit</button>
          <button class="danger-btn" onclick="deleteCustomerPayment('${customer.id}', '${p.id}')">Delete</button>
        </td>
      </tr>
    `).join("");

  $("detailContent").innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(customer.name)}</h2>
      <p>${escapeHtml(customer.phone || "No phone")} ${customer.address ? " · " + escapeHtml(customer.address) : ""}</p>
    </div>

    <div class="detail-summary">
      <div class="detail-stat">
        <span>Total Purchases</span>
        <strong>${money(t.purchases)}</strong>
      </div>
      <div class="detail-stat">
        <span>Total Paid</span>
        <strong>${money(t.payments)}</strong>
      </div>
      <div class="detail-stat">
        <span>Outstanding</span>
        <strong>${money(Math.max(t.balance, 0))}</strong>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Purchase History</h2>
          <p>Every purchase remains stored separately.</p>
        </div>
      </div>
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th><th>Product</th><th>Quantity</th><th>Rate</th><th>Amount</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${purchases || `<tr><td colspan="6">No purchases yet.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="panel" style="margin-top:20px">
      <div class="panel-head">
        <div>
          <h2>Payment History</h2>
          <p>Payments reduce the outstanding balance.</p>
        </div>
      </div>
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Note</th><th>Rate</th><th>Amount</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${payments || `<tr><td colspan="5">No payments yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  setView("customerDetail");
};

window.quickPayment = function(id) {
  setView("payment");
  $("paymentCustomer").value = id;
};


function openEditPurchaseModal(customerId, purchaseId) {
  const customer = customerById(customerId);
  if (!customer) return;

  const purchase = customer.purchases.find(p => p.id === purchaseId);
  if (!purchase) return;

  $("editPurchaseId").value = purchase.id;
  $("editPurchaseCustomerId").value = customer.id;
  $("editPurchaseDate").value = purchase.date;
  $("editPurchaseProduct").value = purchase.product;
  $("editPurchaseQuantity").value = purchase.quantity;
  $("editPurchaseUnit").value = purchase.unit;
  $("editPurchaseRate").value = purchase.rate;
  updateEditPurchaseAmount();

  $("editPurchaseModal").classList.remove("hidden");
}

window.editPurchase = function(customerId, purchaseId) {
  openEditPurchaseModal(customerId, purchaseId);
};

window.deletePurchase = function(customerId, purchaseId) {
  const customer = customerById(customerId);
  if (!customer) return;

  const index = customer.purchases.findIndex(p => p.id === purchaseId);
  if (index === -1) return;

  const purchase = customer.purchases[index];

  const confirmed = confirm(
    `Delete this purchase?\n\n${purchase.product} - ${purchase.quantity} ${purchase.unit} - ${money(purchase.amount)}`
  );

  if (!confirmed) return;

  customer.purchases.splice(index, 1);
  save();
  renderDashboard();
  renderCustomers();
  openCustomer(customerId);
  showToast("Purchase deleted successfully.");
};

function updateEditPurchaseAmount() {
  const quantity = Number($("editPurchaseQuantity").value) || 0;
  const rate = Number($("editPurchaseRate").value) || 0;
  $("editPurchaseAmount").textContent = money(quantity * rate);
}

$("editPurchaseQuantity").addEventListener("input", updateEditPurchaseAmount);
$("editPurchaseRate").addEventListener("input", updateEditPurchaseAmount);

$("closeEditPurchaseModal").addEventListener("click", () => {
  $("editPurchaseModal").classList.add("hidden");
});

$("editPurchaseModal").addEventListener("click", (e) => {
  if (e.target === $("editPurchaseModal")) {
    $("editPurchaseModal").classList.add("hidden");
  }
});

$("editPurchaseForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const customer = customerById($("editPurchaseCustomerId").value);
  if (!customer) return;

  const purchase = customer.purchases.find(
    p => p.id === $("editPurchaseId").value
  );

  if (!purchase) return;

  const quantity = Number($("editPurchaseQuantity").value);
  const rate = Number($("editPurchaseRate").value);

  purchase.date = $("editPurchaseDate").value;
  purchase.product = $("editPurchaseProduct").value.trim();
  purchase.quantity = quantity;
  purchase.unit = $("editPurchaseUnit").value.trim() || "unit";
  purchase.rate = rate;
  purchase.amount = quantity * rate;

  save();
  $("editPurchaseModal").classList.add("hidden");

  renderDashboard();
  renderCustomers();
  openCustomer(customer.id);

  showToast("Purchase updated successfully.");
});

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("purchaseDate").value = today();
$("paymentDate").value = today();
$("supplierPurchaseDate").value = today();
$("supplierPaymentDate").value = today();
$("labourWorkDate").value = today();
$("labourPaymentDate").value = today();
populateCustomerSelects();
populateSupplierSelects();
populateLabourSelects();
renderDashboard();
renderCustomers();
renderSuppliers();
renderLabours();
updateLabourPreview();



function hasLocalBusinessData() {
  return Boolean(
    state.customers.length ||
    state.suppliers.length ||
    state.labours.length
  );
}

function cloudStateHasData(cloudState) {
  return Boolean(
    cloudState &&
    (
      Array.isArray(cloudState.customers) && cloudState.customers.length ||
      Array.isArray(cloudState.suppliers) && cloudState.suppliers.length ||
      Array.isArray(cloudState.labours) && cloudState.labours.length
    )
  );
}

function normalizeState(input) {
  const next = input && typeof input === "object" ? input : {};

  if (!Array.isArray(next.customers)) next.customers = [];
  if (!Array.isArray(next.suppliers)) next.suppliers = [];
  if (!Array.isArray(next.labours)) next.labours = [];

  next.customers.forEach(c => {
    if (!Array.isArray(c.purchases)) c.purchases = [];
    if (!Array.isArray(c.payments)) c.payments = [];
  });

  next.suppliers.forEach(s => {
    if (!Array.isArray(s.purchases)) s.purchases = [];
    if (!Array.isArray(s.payments)) s.payments = [];
  });

  next.labours.forEach(l => {
    if (!Array.isArray(l.work)) l.work = [];
    if (!Array.isArray(l.payments)) l.payments = [];
  });

  return next;
}

function rerenderAll() {
  populateCustomerSelects();
  populateSupplierSelects();
  populateLabourSelects();
  renderDashboard();
  renderCustomers();
  renderSuppliers();
  renderLabours();
}

async function initializeFirebaseConnection() {
  $("cloudLoginBtn").addEventListener("click", async () => {
    try {
      setCloudStatus("Signing in…");
      await signInGoogle();
    } catch (error) {
      console.error("Google sign-in error:", error);
      setCloudStatus("Sign-in failed", "error");
      const code = error?.code ? ` [${error.code}]` : "";
      showToast(`Google sign-in failed${code}: ${error?.message || "Unknown error"}`);
    }
  });

  $("cloudLogoutBtn").addEventListener("click", async () => {
    try {
      await signOutGoogle();
    } catch (error) {
      console.error(error);
      showToast("Could not sign out.");
    }
  });

  if (!isFirebaseConfigured()) {
    setCloudStatus("Firebase not configured", "error");
    $("cloudLoginBtn").textContent = "Setup Firebase first";
    $("cloudLoginBtn").disabled = true;
    return;
  }

  setCloudStatus("Connecting…");

  onUserChanged(async (user) => {
    currentFirebaseUser = user || null;

    if (!user) {
      $("cloudUser").textContent = "";
      $("cloudLoginBtn").classList.remove("hidden");
      $("cloudLogoutBtn").classList.add("hidden");
      $("cloudLoginBtn").disabled = false;
      $("cloudLoginBtn").textContent = "Sign in with Google";
      setCloudStatus("Local copy");
      const help = $("cloudHelp");
      if (help) help.textContent = "Sign in with Google to sync your data.";
      return;
    }

    $("cloudUser").textContent = user.email || user.displayName || "Signed in";
    $("cloudLoginBtn").classList.add("hidden");
    $("cloudLogoutBtn").classList.remove("hidden");
    const help = $("cloudHelp");
    if (help) help.textContent = "Google account connected. Loading your cloud ledger…";

    try {
      const cloudState = normalizeState(await loadCloudState(user.uid));
      const localHasData = hasLocalBusinessData();
      const cloudHasData = cloudStateHasData(cloudState);

      suppressCloudSync = true;

      if (!cloudState || !cloudHasData) {
        // First cloud use for this account: preserve the browser's existing data.
        await saveCloudState(user.uid, state);
        setCloudStatus("Cloud saved", "connected");
      } else if (!localHasData) {
        // New device/browser: bring the cloud copy down.
        state = cloudState;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        rerenderAll();
        setCloudStatus("Cloud loaded", "connected");
      } else {
        // Both sides have data. Do not silently overwrite either one.
        const useCloud = confirm(
          "Cloud data already exists for this Google account.\n\n" +
          "OK = use the cloud data on this device.\n" +
          "Cancel = keep this device's data and replace the cloud copy with it.\n\n" +
          "Export a local backup first if both copies contain important changes."
        );

        if (useCloud) {
          state = cloudState;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          rerenderAll();
          setCloudStatus("Cloud loaded", "connected");
        } else {
          await saveCloudState(user.uid, state);
          setCloudStatus("Local copied to cloud", "connected");
        }
      }
    } catch (error) {
      console.error("Firebase load error:", error);
      setCloudStatus("Cloud connection error", "error");
      showToast("Could not load cloud data. Your local copy remains available.");
    } finally {
      suppressCloudSync = false;
    }
  });

}


// Mobile navigation
const mobileMenuBtn = $("mobileMenuBtn");
const mobileOverlay = $("mobileOverlay");

function closeMobileMenu() {
  document.querySelector(".sidebar").classList.remove("mobile-open");
  mobileOverlay.classList.remove("show");
}

mobileMenuBtn.addEventListener("click", () => {
  document.querySelector(".sidebar").classList.toggle("mobile-open");
  mobileOverlay.classList.toggle("show");
});

mobileOverlay.addEventListener("click", closeMobileMenu);

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", closeMobileMenu);
});

// Export/import a portable JSON backup of all current browser data.
$("exportDataBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledgerpro-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Backup exported successfully.");
});

$("importDataInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    if (!imported || !Array.isArray(imported.customers) || !Array.isArray(imported.suppliers) || !Array.isArray(imported.labours)) {
      throw new Error("Invalid backup structure");
    }

    if (!confirm("Importing a backup will replace the current data in this browser. Continue?")) {
      e.target.value = "";
      return;
    }

    state.customers = imported.customers;
    state.suppliers = imported.suppliers;
    state.labours = imported.labours;
    save();
    location.reload();
  } catch (error) {
    showToast("Invalid backup file.");
  } finally {
    e.target.value = "";
  }
});


