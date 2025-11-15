// --- START of MilkDelivery Portal Logic (Plain JS) ---

// --- CONFIGURATION & GLOBAL STATE ---
const firebaseConfig = {
    apiKey: "AIzaSyB50H4ChFhcbxURE1aTr0WNKZaNMnVDNmE",
    authDomain: "varnikasdairyfarm.firebaseapp.com",
    projectId: "varnikasdairyfarm",
    storageBucket: "varnikasdairyfarm.firebasestorage.app",
    messagingSenderId: "702396701165",
    appId: "1:702396701165:web:484bd8432a8d3f0694afe4"
};

const appId = firebaseConfig.projectId;
let userId = null; // Anonymous Firebase User ID
// UPDATED: Now holds objects { uid, name }
let registeredUids = []; // Array to hold UIDs and Names of all known users 
let customers = [];
let transactions = []; 
let displayedTransactions = []; 
let db = null;
let activeView = 'log'; 
let transactionToDelete = null; 
let customerToDelete = null;
let currentUserName = "Authenticating..."; // NEW: To hold the currently active user's name

const QUANTITY_OPTIONS = ['250 ml', '500 ml', '1 Litre', '1.5 Litres', '2 Litres', 'Other'];
const STATUS_OPTIONS = ['Delivered', 'Not needed'];

// DATE FIX: Get TODAY's date (YYYY-MM-DD) reliably using the IST context
function getTodayDate() {
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(utcTime + istOffset);
    
    const year = istTime.getFullYear();
    const month = String(istTime.getMonth() + 1).padStart(2, '0');
    const day = String(istTime.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- DOM REFERENCES ---
const mainContent = document.getElementById('main-content');
const appHeader = document.getElementById('app-header'); 
const navButtons = {
    log: document.getElementById('nav-log'),
    customers: document.getElementById('nav-customers'),
    export: document.getElementById('nav-history')
};
const deleteModal = document.getElementById('delete-modal');
const customerModal = document.getElementById('customer-modal'); 
const deleteAllModal = document.getElementById('delete-all-modal');

// --- CORE UTILITIES ---

function getCustomerPath() {
    // IMPORTANT: Customers collection is NOT tied to userId. All users share the same customer list.
    return userId ? `artifacts/${appId}/customers` : null; 
}

function getDeliveryPath() {
    // Delivery collection IS tied to userId. Each user has their own delivery log.
    return userId ? `artifacts/${appId}/users/${userId}/deliveries` : null;
}

// NEW: Function to get the User's name by UID
function getUserName(uid) {
    const user = registeredUids.find(u => u.uid === uid);
    return user ? user.name : `User: ${uid.substring(0, 8)}...`;
}

function getQuantityInML(quantityStr) {
    if (!quantityStr) return 0;
    
    const parts = quantityStr.toLowerCase().split(' ');
    let numericValue = parseFloat(parts[0]);
    let unit = parts.length > 1 ? parts[1] : '';

    if (isNaN(numericValue)) return 0;

    if (unit.startsWith('litre')) {
        return numericValue * 1000;
    } 
    return numericValue;
}

function groupTransactionsByMonth(data) {
    return data.reduce((groups, transaction) => {
        const date = new Date(transaction.date);
        const monthYearKey = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        
        if (!groups[monthYearKey]) {
            groups[monthYearKey] = [];
        }
        groups[monthYearKey].push(transaction);
        return groups;
    }, {});
}

// --- USER MANAGEMENT (UID SWITCHING) ---

function setupUidListener() {
    if (!db) return;
    
    // Listen to the portalUsers collection to get a list of all UIDs that have logged in, along with their names
    db.collection('portalUsers').onSnapshot((snapshot) => {
        registeredUids = snapshot.docs.map(doc => ({
            uid: doc.id,
            name: doc.data().name || `User: ${doc.id.substring(0, 8)}...`
        }));
        
        // Update the current user's name
        currentUserName = getUserName(userId);

        renderHeader();
        
        // Setup data listeners for the currently active UID
        setupCustomerListener(); 
        setupDeliveryListener();
        
        // Initial render of the main application content
        renderApp(activeView); 
    }, (e) => {
        console.error("Error fetching registered UIDs:", e);
    });
}

function renderHeader() {
    // The name to display in the header (e.g., "Welcome, John")
    const headerNameDisplay = currentUserName.includes('User:') ? currentUserName : `Welcome, ${currentUserName}`;
    
    // Create dropdown options for all known UIDs/Names
    let uidOptions = registeredUids.map(user => 
        `<option value="${user.uid}" ${user.uid === userId ? 'selected' : ''}>${user.name}</option>`
    ).join('');
    
    // Fallback: Ensure the current user's UID/Name is included if the list is empty or slow to update
    if (userId && !registeredUids.find(u => u.uid === userId)) {
         uidOptions = `<option value="${userId}" selected>${currentUserName}</option>` + uidOptions;
    }


    appHeader.innerHTML = `
        <h1 class="text-xl font-extrabold text-center">Varnika's Dairy Farm</h1>
        <p class="text-sm text-center font-light">${headerNameDisplay} | Fresh Milk Tracker (IST)</p>
        <div id="user-display-container" class="text-center mt-2 opacity-90">
            <select id="user-uid-dropdown" class="bg-green-600 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-green-500 transition duration-150">
                <option value="" disabled>Select User (Name)</option>
                ${uidOptions}
            </select>
        </div>
    `;
    
    document.getElementById('user-uid-dropdown')?.addEventListener('change', handleUidSwitch);
}

function handleUidSwitch(e) {
    const newUid = e.target.value;
    if (newUid && newUid !== userId) {
        userId = newUid;
        currentUserName = getUserName(newUid); // Set the new user's name
        
        // Re-setup listeners with the new UID
        setupCustomerListener(); // Note: Customer listener is now shared, but we call it for consistency
        setupDeliveryListener();
        renderHeader(); // Update selected option and header name
        renderApp(activeView); // Force view refresh
    }
}

// NEW: Function to ask the user for their name
function askForUserName() {
    customerModal.innerHTML = `
        <div class="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-green-700">Set Your User Name</h3>
            </div>
            <p class="text-gray-700 mb-4">Please enter your name to personalize your portal experience and distinguish your deliveries.</p>
            <form id="set-name-form" class="space-y-4">
                <div>
                    <label htmlFor="user-name-input" class="block text-sm font-medium text-gray-700">Your Name</label>
                    <input
                        id="user-name-input"
                        name="user-name-input"
                        type="text"
                        placeholder="e.g., John or Assistant"
                        required
                        class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 p-2 border"
                    />
                </div>
                <button
                    type="submit"
                    id="set-name-submit-btn"
                    class="w-full bg-green-600 text-white py-2 px-4 rounded-xl font-semibold shadow-md hover:bg-green-700 transition duration-150"
                >
                    Save Name
                </button>
            </form>
        </div>
    `;

    customerModal.style.display = 'flex';
    customerModal.classList.remove('hidden');
    
    document.getElementById('user-name-input').focus(); 

    document.getElementById('set-name-form').addEventListener('submit', handleSetName);
}

// NEW: Handler for saving the user's name
function handleSetName(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.elements['user-name-input'].value.trim();
    const submitBtn = document.getElementById('set-name-submit-btn');

    if (!db || !userId || !name) return;
    if (name.length < 2) return alert("Please enter a name of at least 2 characters.");

    submitBtn.textContent = 'Saving...';
    submitBtn.disabled = true;

    // Update the portalUsers document with the user's name
    db.collection('portalUsers').doc(userId).set({ 
        name: name,
        registeredAt: firebase.firestore.FieldValue.serverTimestamp() 
    }, { merge: true })
    .then(() => {
        currentUserName = name; // Update local state
        closeCustomerModal(); // Close the name setting modal (reusing customerModal)
        setupUidListener(); // Re-run listener to update the registeredUids list and header
    })
    .catch(e => {
        console.error("Error setting user name:", e);
        alert("Failed to set user name.");
        submitBtn.textContent = 'Save Name';
        submitBtn.disabled = false;
    });
}

// --- DATA LISTENERS --- 

function setupCustomerListener() {
    const customerPath = getCustomerPath();
    if (!db || !customerPath) {
        console.warn("Customer Listener skipped: DB or path is null.");
        return;
    }

    db.collection(customerPath).onSnapshot((snapshot) => {
        customers = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        console.log(`[Customer Data]: Fetched ${customers.length} customers from path: ${customerPath}`);
        
        // Check if we are stuck in the name-setting phase and prevent rerender
        if (customerModal.style.display === 'flex' && !document.getElementById('add-customer-form')) {
             return; 
        }

        renderApp(activeView); 
    }, (e) => {
        // --- CRITICAL ERROR LOGGING ---
        console.error("--- ERROR FETCHING CUSTOMERS ---");
        console.error("Path attempted:", customerPath);
        console.error("Firebase Error Code:", e.code);
        console.error("Firebase Error Message:", e.message);
        console.error("----------------------------------");
        // ------------------------------------
    });
}

function setupDeliveryListener() {
    const deliveryPath = getDeliveryPath();
    if (!db || !deliveryPath) return;
    
    // UPDATED: Use the current userId's path for deliveries
    db.collection(deliveryPath).orderBy('timestamp', 'desc').onSnapshot((snapshot) => {
        transactions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            date: doc.data().date, 
            dateDisplay: new Date(doc.data().date || Date.now()).toLocaleDateString('en-US') 
        }));
        displayedTransactions = [...transactions]; 
        
        renderApp(activeView);
    }, (e) => {
        console.error("Error fetching transactions:", e);
    });
}

// --- INITIALIZATION ---

function initFirebase() {
    renderHeader(); 
    
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        console.error("Firebase libraries failed to load.");
        return;
    }

    try {
        const app = firebase.initializeApp(firebaseConfig, appId);
        const auth = app.auth();
        db = app.firestore();
        
        auth.onAuthStateChanged((user) => {
            if (user) {
                userId = user.uid;
                
                // CRUCIAL: Check if user name is set
                db.collection('portalUsers').doc(userId).get()
                    .then(doc => {
                        if (doc.exists && doc.data().name) {
                            // User is registered and has a name
                            currentUserName = doc.data().name;
                            setupUidListener();
                        } else {
                            // New user OR existing user without a name
                            db.collection('portalUsers').doc(userId).set({ 
                                registeredAt: firebase.firestore.FieldValue.serverTimestamp() 
                            }, { merge: true }).then(() => {
                                // Now ask for the name
                                askForUserName(); 
                                // Setup the main listener, which will update once the name is set
                                setupUidListener(); 
                            });
                        }
                    })
                    .catch(e => {
                        console.error("Error logging UID/fetching name:", e);
                        setupUidListener();
                    });

            } else {
                auth.signInAnonymously()
                    .catch(e => {
                        console.error("Auth error:", e);
                        renderHeader(); 
                    });
            }
        });
    } catch (e) {
        console.error("Initialization error:", e);
        renderHeader();
    }
}


// --- MODAL HANDLERS (Deletion and Customer Add/Delete logic) ---

function closeDeleteModal() {
    deleteModal.classList.add('hidden');
    deleteModal.style.display = 'none';
    transactionToDelete = null;
    customerToDelete = null; 
}

function openDeleteModal(id, name, isCustomer = false) {
    if (isCustomer) {
        customerToDelete = { id, name };
        transactionToDelete = null;
    } else {
        transactionToDelete = { id, name };
        customerToDelete = null;
    }
    
    const title = isCustomer ? "Confirm Customer Deletion" : "Confirm Delivery Deletion";
    const message = isCustomer 
        ? `Are you sure you want to permanently delete the customer <b>${name}</b>? This action cannot be undone.`
        : `Are you sure you want to permanently delete the delivery log for <b>${name}</b>? This action cannot be undone.`;
    
    const confirmHandler = isCustomer ? handleDeleteCustomer : handleDeleteTransaction;
    const confirmText = isCustomer ? "Confirm Delete Customer" : "Confirm Delete";

    deleteModal.innerHTML = `
        <div class="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-red-700">${title}</h3>
                <button id="modal-close-btn" class="text-gray-400 hover:text-gray-600">❌</button>
            </div>
            <p class="text-gray-700 mb-6">${message}</p>
            <div class="flex justify-end space-x-3">
                <button id="modal-cancel-btn" class="bg-gray-200 text-gray-800 py-2 px-4 rounded-xl font-semibold hover:bg-gray-300 transition duration-150">
                    Cancel
                </button>
                <button id="modal-confirm-btn" class="bg-red-600 text-white py-2 px-4 rounded-xl font-semibold shadow-md hover:bg-red-700 transition duration-150">
                    ${confirmText}
                </button>
            </div>
        </div>
    `;

    deleteModal.style.display = 'flex';
    deleteModal.classList.remove('hidden');

    document.getElementById('modal-close-btn').addEventListener('click', closeDeleteModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeDeleteModal);
    document.getElementById('modal-confirm-btn').addEventListener('click', confirmHandler);
}

function handleDeleteTransaction() {
    if (!db || !userId || !transactionToDelete) return;

    const { id, name } = transactionToDelete;

    const confirmButton = document.getElementById('modal-confirm-btn');
    confirmButton.textContent = 'Deleting...';
    confirmButton.disabled = true;

    const deliveryPath = getDeliveryPath();
    db.collection(deliveryPath).doc(id).delete()
        .then(() => {
            closeDeleteModal();
        })
        .catch(e => {
            console.error("Error deleting transaction:", e);
            alert(`Failed to delete transaction record for ${name}.`);
            closeDeleteModal();
        });
}

function handleDeleteCustomer() {
    if (!db || !userId || !customerToDelete) return;

    const { id, name } = customerToDelete;

    const confirmButton = document.getElementById('modal-confirm-btn');
    confirmButton.textContent = 'Deleting...';
    confirmButton.disabled = true;

    // UPDATED: Customer path is now shared
    const customerPath = getCustomerPath(); 
    db.collection(customerPath).doc(id).delete()
        .then(() => {
            closeDeleteModal();
        })
        .catch(e => {
            console.error("Error deleting customer:", e);
            alert(`Failed to delete customer ${name}.`);
            closeDeleteModal();
        });
}

function closeDeleteAllModal() {
    deleteAllModal.classList.add('hidden');
    deleteAllModal.style.display = 'none';
}

function openDeleteAllModal() {
    deleteAllModal.style.display = 'flex';
    deleteAllModal.classList.remove('hidden');

    // Inject Modal HTML
    deleteAllModal.innerHTML = `
        <div class="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-red-700">⚠️ Confirm Delete All History</h3>
                <button id="modal-close-all-btn" class="text-gray-400 hover:text-gray-600">❌</button>
            </div>
            <p class="text-gray-700 mb-6 font-semibold text-lg">Are you absolutely sure you want to permanently delete ALL (${transactions.length}) delivery records for <b class="text-red-700">${currentUserName}</b>? This cannot be undone.</p>
            <div class="flex justify-end space-x-3">
                <button id="modal-cancel-all-btn" class="bg-gray-200 text-gray-800 py-2 px-4 rounded-xl font-semibold hover:bg-gray-400 transition duration-150">
                    Cancel
                </button>
                <button id="modal-confirm-all-btn" class="bg-red-600 text-white py-2 px-4 rounded-xl font-semibold shadow-md hover:bg-red-700 transition duration-150">
                    YES, Delete All History
                </button>
            </div>
        </div>
    `;

    document.getElementById('modal-close-all-btn').addEventListener('click', closeDeleteAllModal);
    document.getElementById('modal-cancel-all-btn').addEventListener('click', closeDeleteAllModal);
    document.getElementById('modal-confirm-all-btn').addEventListener('click', handleDeleteAllHistory);
}

function handleDeleteAllHistory() {
    const totalRecords = transactions.length;
    if (totalRecords === 0) {
        alert("History is already empty!");
        closeDeleteAllModal();
        return;
    }
    
    const confirmButton = document.getElementById('modal-confirm-all-btn');
    confirmButton.textContent = `Deleting ${totalRecords} records...`;
    confirmButton.disabled = true;

    const deliveryPath = getDeliveryPath();
    const batchSize = 500; 
    
    // Note: We only delete the records for the currently active user (userId)
    db.collection(deliveryPath).get()
        .then(snapshot => {
            const batches = [];
            
            snapshot.docs.forEach((doc, index) => {
                if (index % batchSize === 0) {
                    batches.push(db.batch());
                }
                const currentBatch = batches[batches.length - 1];
                currentBatch.delete(doc.ref);
            });

            const promises = batches.map(batch => batch.commit());
            
            return Promise.all(promises);
        })
        .then(() => {
            transactions = [];
            displayedTransactions = [];
            renderApp(activeView); 

            alert(`Successfully deleted all ${totalRecords} history records for ${currentUserName}.`);
            closeDeleteAllModal();
        })
        .catch(e => {
            console.error("Error deleting all history:", e);
            alert("An error occurred while deleting history. Please check Firebase console/security rules.");
            closeDeleteAllModal();
        });
}


// --- MODAL HANDLERS (Customer Add) ---

function closeCustomerModal() {
    customerModal.classList.add('hidden');
    customerModal.style.display = 'none';
    // Remove all event listeners for the set-name form if present, to clean up after its use
    document.getElementById('set-name-form')?.removeEventListener('submit', handleSetName);
}

function openCustomerModal() {
    let quantityOptions = QUANTITY_OPTIONS.map(opt => `<option value="${opt}" ${opt === '500 ml' ? 'selected' : ''}>${opt}</option>`).join('');

    customerModal.innerHTML = `
        <div class="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-green-700">Add New Customer</h3>
                <button id="customer-modal-close-btn" class="text-gray-400 hover:text-gray-600">❌</button>
            </div>
            <form id="add-customer-form" class="space-y-4">
                <div>
                    <label htmlFor="customer-name" class="block text-sm font-medium text-gray-700">Customer Name</label>
                    <input
                        id="customer-name"
                        name="customer-name"
                        type="text"
                        placeholder="e.g., John Smith"
                        required
                        class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 p-2 border"
                    />
                </div>
                <div>
                    <label htmlFor="preferred-qty" class="block text-sm font-medium text-gray-700">Preferred Daily Quantity</label>
                    <select
                        id="preferred-qty"
                        name="preferred-qty"
                        class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 p-2 border"
                    >
                        ${quantityOptions}
                    </select>
                </div>
                <button
                    type="submit"
                    id="customer-submit-btn"
                    class="w-full bg-green-600 text-white py-2 px-4 rounded-xl font-semibold shadow-md hover:bg-green-700 transition duration-150"
                >
                    ➕ Add Customer
                </button>
            </form>
        </div>
    `;

    customerModal.style.display = 'flex';
    customerModal.classList.remove('hidden');
    
    document.getElementById('customer-name').focus(); 

    document.getElementById('customer-modal-close-btn').addEventListener('click', closeCustomerModal);
    document.getElementById('add-customer-form').addEventListener('submit', handleAddCustomer);
}

function handleAddCustomer(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.elements['customer-name'].value.trim();
    const preferredQuantity = form.elements['preferred-qty'].value;
    const submitBtn = document.getElementById('customer-submit-btn');

    if (!db || !userId || !name) return;

    submitBtn.textContent = 'Adding...';
    submitBtn.disabled = true;

    const newCustomer = {
        name: name,
        preferredQuantity: preferredQuantity,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        // NEW: Log who created the customer for transparency, though customers are shared.
        createdByUid: userId, 
        createdByName: currentUserName,
    };

    const customerPath = getCustomerPath(); // Shared collection
    db.collection(customerPath).add(newCustomer)
        .then(() => {
            submitBtn.textContent = '➕ Add Customer';
            submitBtn.disabled = false;
            closeCustomerModal();
        })
        .catch(e => {
            console.error("Error adding customer:", e);
            alert("Failed to add new customer.");
            submitBtn.textContent = '➕ Add Customer';
            submitBtn.disabled = false;
        });
}


// --- FORM & EXPORT HANDLERS (Delivery Log) ---

function handleCustomerSelectChange(e) {
    const selectedId = e.target.value;
    const customer = customers.find(c => c.id === selectedId);
    const quantitySelect = document.getElementById('quantity');
    
    if (customer && quantitySelect) {
        quantitySelect.value = customer.preferredQuantity || '500 ml';
    }
}

function handleSaveDelivery(e) {
    e.preventDefault();
    const form = e.target;
    const selectedDate = form.elements['delivery-date'].value;
    const customerId = form.elements['customer'].value;
    const selectedQuantity = form.elements['quantity'].value;
    const deliveryStatus = form.elements['status'].value;
    
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return alert("Please select a valid customer.");
    
    const TODAY = getTodayDate(); // Re-fetch TODAY inside the handler to ensure accuracy
    if (selectedDate > TODAY) {
        alert("Cannot save a delivery log for a future date.");
        form.elements['delivery-date'].value = TODAY; 
        return;
    }

    const deliveryRecord = {
        customerId: customerId,
        customerName: customer.name,
        date: selectedDate, // YYYY-MM-DD
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        quantity: deliveryStatus === 'Delivered' ? selectedQuantity : '0 ml',
        actualQuantity: selectedQuantity,
        status: deliveryStatus,
        // NEW: Add the logger's UID and Name for transparency
        loggerUid: userId,
        loggerName: currentUserName,
    };

    const deliveryPath = getDeliveryPath(); // User-specific collection
    db.collection(deliveryPath).add(deliveryRecord)
        .then(() => {
            alert(`Delivery saved successfully by ${currentUserName}!`);
            form.elements['delivery-date'].value = TODAY; 
            form.elements['status'].value = 'Delivered';
        })
        .catch(e => {
            console.error("Error saving delivery:", e);
            alert("Failed to save delivery entry.");
        });
}

function applyFilter() {
    const fromDateInput = document.getElementById('filter-from-date');
    const toDateInput = document.getElementById('filter-to-date');
    
    const fromDate = fromDateInput ? fromDateInput.value : null;
    const toDate = toDateInput ? toDateInput.value : null;

    if (!fromDate || !toDate) {
        displayedTransactions = [...transactions];
    } else {
        displayedTransactions = transactions.filter(t => {
            const transactionDate = t.date; // Date is stored in YYYY-MM-DD
            return transactionDate >= fromDate && transactionDate <= toDate;
        });
    }

    renderHistoryView();
}

function handleExportSpreadsheet() {
    const dataToExport = displayedTransactions; 
    
    if (dataToExport.length === 0) {
        return alert("No data to export!");
    }

    const headers = ["Date", "Customer Name", "Quantity Delivered (ml)", "Status", "Preferred Quantity", "Logged By"]; // UPDATED header
    const csvContent = [headers.join(',')];

    dataToExport.forEach(t => {
        const quantityValueInML = getQuantityInML(t.quantity);
        
        const row = [
            t.dateDisplay,
            t.customerName,
            quantityValueInML, 
            t.status,
            t.actualQuantity,
            t.loggerName || 'N/A', // UPDATED: Include logger name
        ];
        csvContent.push(row.map(item => `"${item}"`).join(','));
    });

    const blob = new Blob([csvContent.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `VarnikasDairyFarm_Deliveries_${currentUserName}_${getTodayDate()}.csv`); // UPDATED: Include user name in file name
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * EXPORT ALL USERS' DATA
 * - Reads portalUsers collection to get every UID
 * - For each UID, reads artifact/{appId}/users/{uid}/deliveries
 * - Builds a single CSV containing all users' deliveries
 *
 * NOTE: This operation requires read access to each user's deliveries collection.
 */
async function handleExportAllUsers() {
    if (!db) return alert("Database not initialized.");

    try {
        // Fetch all registered users
        const usersSnapshot = await db.collection('portalUsers').get();
        if (usersSnapshot.empty) {
            return alert("No registered users found.");
        }

        const allData = []; // will hold rows

        for (let userDoc of usersSnapshot.docs) {
            const uid = userDoc.id;
            const userName = userDoc.data().name || uid.substring(0, 6);

            const deliveryPath = `artifacts/${appId}/users/${uid}/deliveries`;
            // Read deliveries for this user
            const deliveriesSnapshot = await db.collection(deliveryPath).orderBy('timestamp', 'desc').get();

            deliveriesSnapshot.forEach(doc => {
                const t = doc.data();
                allData.push({
                    uid,
                    userName,
                    date: t.date || '',
                    dateDisplay: new Date(t.date || Date.now()).toLocaleDateString('en-US'),
                    customerName: t.customerName || '',
                    quantityMl: getQuantityInML(t.quantity || '0 ml'),
                    status: t.status || '',
                    preferred: t.actualQuantity || '',
                    loggerName: t.loggerName || userName
                });
            });
        }

        if (allData.length === 0) {
            return alert("No delivery data found for any user.");
        }

        // Build CSV
        const headers = [
            "UID", "User Name", "Date", "Customer Name",
            "Quantity Delivered (ml)", "Status", "Preferred Qty", "Logger Name"
        ];
        const csvRows = [headers.join(',')];

        allData.forEach(r => {
            csvRows.push([
                r.uid,
                r.userName,
                r.dateDisplay,
                r.customerName,
                r.quantityMl,
                r.status,
                r.preferred,
                r.loggerName
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        });

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `VarnikasDairyFarm_ALL_USERS_${getTodayDate()}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (e) {
        console.error("Error exporting all users:", e);
        alert("Failed to export all users. Check console for details and verify Firestore security rules allow cross-user reads.");
    }
}

// --- VIEW RENDERING (Template Functions) ---

function renderDailyLog() {
    const TODAY_DATE = getTodayDate();
    
    const defaultCustomerId = customers.length > 0 ? customers[0].id : '';
    const defaultQuantity = customers.length > 0 ? (customers[0].preferredQuantity || '500 ml') : '500 ml';

    let customerOptions = customers.map(c => 
        `<option value="${c.id}" ${c.id === defaultCustomerId ? 'selected' : ''}>${c.name}</option>`
    ).join('');
    
    let quantityOptions = QUANTITY_OPTIONS.map(opt => 
        `<option value="${opt}" ${opt === defaultQuantity ? 'selected' : ''}>${opt}</option>`
    ).join('');
    
    let statusOptions = STATUS_OPTIONS.map(opt => `<option value="${opt}">${opt}</option>`).join('');

    if (customers.length === 0) {
        // ... (No change in the 'No Customers' block)
        mainContent.innerHTML = `<div class="p-4 bg-yellow-100 text-yellow-800 rounded-lg border border-yellow-300 text-center space-y-3">
             <p class="font-semibold mb-2">No Customers Found</p>
             <button id="add-customer-btn" class="w-full bg-blue-600 text-white py-2 px-4 rounded-xl font-semibold hover:bg-blue-700 transition duration-150">
                 <span class="text-xl">➕</span> Add Customer Now
             </button>
           </div>`;
        document.getElementById('add-customer-btn')?.addEventListener('click', openCustomerModal); 
        return;
    }

    mainContent.innerHTML = `
        <div class="p-4 space-y-6">
            <h2 class="text-2xl font-bold text-gray-800">Daily Milk Delivery Log (${currentUserName})</h2> <form id="delivery-form" class="bg-white p-5 rounded-xl shadow-lg space-y-4">
                
                <div>
                    <label htmlFor="delivery-date" class="block text-sm font-semibold text-gray-700 mb-1">Select Delivery Date</label>
                    <input
                        id="delivery-date"
                        name="delivery-date"
                        type="date"
                        value="${getTodayDate()}"
                        max="${getTodayDate()}" 
                        required
                        class="w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 p-3 border text-lg cursor-pointer"
                    />
                </div>
                
                <div>
                    <label htmlFor="customer" class="block text-sm font-semibold text-gray-700 mb-1">Select Customer</label>
                    <select
                        id="customer"
                        name="customer"
                        required
                        class="w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 p-3 border text-lg"
                    >
                        ${customerOptions}
                    </select>
                </div>

                <div>
                    <label htmlFor="quantity" class="block text-sm font-semibold text-gray-700 mb-1">Quantity Delivered</label>
                    <select
                        id="quantity"
                        name="quantity"
                        required
                        class="w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 p-3 border text-lg"
                    >
                        ${quantityOptions}
                    </select>
                </div>

                <div>
                    <label htmlFor="status" class="block text-sm font-semibold text-gray-700 mb-1">Delivery Status</label>
                    <select
                        id="status"
                        name="status"
                        required
                        class="w-full rounded-lg border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 p-3 border text-lg"
                    >
                        ${statusOptions}
                    </select>
                </div>

                <button
                    type="submit"
                    class="w-full flex items-center justify-center bg-green-600 text-white py-3 rounded-xl font-bold text-xl shadow-xl transition duration-150 hover:bg-green-700"
                >
                    <span class="text-xl">💾</span> Save Log
                </button>
            </form>
        </div>
    `;

    const deliveryForm = document.getElementById('delivery-form');
    if(deliveryForm) {
        deliveryForm.addEventListener('submit', handleSaveDelivery);
        document.getElementById('customer')?.addEventListener('change', handleCustomerSelectChange);
        
        const dateInput = document.getElementById('delivery-date');
        
        dateInput.addEventListener('click', (e) => {
             if (e.target.showPicker) {
                 e.target.showPicker();
             } else {
                 e.target.focus();
             }
        });

        dateInput.addEventListener('change', (e) => {
            const TODAY_CHECK = getTodayDate();
             if (e.target.value > TODAY_CHECK) {
                 alert("Delivery date cannot be more than today's date.");
                 e.target.value = TODAY_CHECK; 
             }
        });
    }
}

function renderCustomerView() {
    let customerListHtml = customers.length === 0 
        ? `<p class="text-center text-gray-500 p-4">No customers added yet. Click 'Add' to begin.</p>`
        : customers.map(c => `
            <div class="bg-white p-4 rounded-xl shadow-md flex justify-between items-center">
                <div>
                    <p class="font-bold text-lg text-gray-800">${c.name}</p>
                    <p class="text-sm text-gray-500">Pref. Qty: <span class="font-medium text-green-600">${c.preferredQuantity}</span></p>
                    <p class="text-xs text-gray-400">Added by: ${c.createdByName || 'Unknown'}</p> </div>
                <button class="delete-customer-btn text-red-500 p-1 rounded-full hover:bg-red-100 transition duration-150" aria-label="Delete customer" data-id="${c.id}" data-name="${c.name}">
                    <span class="text-xl">❌</span>
                </button>
            </div>
        `).join('');

    mainContent.innerHTML = `
        <div class="p-4 space-y-6">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold text-gray-800">Manage Customers (${customers.length})</h2>
                <button id="add-customer-modal-btn" class="flex items-center bg-blue-600 text-white px-3 py-2 rounded-xl text-sm font-semibold shadow-md hover:bg-blue-700 transition duration-150">
                    <span class="text-xl mr-1">➕</span> Add
                </button>
            </div>
            <div class="space-y-3">
                ${customerListHtml}
            </div>
        </div>
    `;
    document.getElementById('add-customer-modal-btn')?.addEventListener('click', openCustomerModal); 
    
    document.querySelectorAll('.delete-customer-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            openDeleteModal(id, name, true); 
        });
    });
}

function renderHistoryView() {
    const TODAY = getTodayDate();
    
    const groupedTransactions = groupTransactionsByMonth(displayedTransactions);
    
    let monthFoldersHtml = Object.keys(groupedTransactions).sort((a, b) => {
        const dateA = new Date(a);
        const dateB = new Date(b);
        return dateB - dateA;
    }).map(monthYearKey => {
        const monthTransactions = groupedTransactions[monthYearKey];
        
        let transactionListHtml = monthTransactions.map(t => {
            const color = t.status === 'Delivered' ? '#10B981' : '#F59E0B';
            const statusClass = t.status === 'Delivered' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';
            const loggerInfo = t.loggerName ? `<span class="text-xs text-gray-400 block mt-1">Logged by: ${t.loggerName}</span>` : ''; // NEW: Show logger name
            
            return `
                <div class="bg-white p-4 rounded-xl shadow-sm border-l-4 flex justify-between items-center mt-2 ml-4" style="border-color: ${color};">
                    <div>
                        <p class="text-xs text-gray-500">${t.dateDisplay}</p>
                        <p class="font-bold text-lg text-gray-800">${t.customerName}</p>
                        <p class="text-sm text-gray-600">Qty: <span class="font-bold">${t.quantity}</span></p>
                        ${loggerInfo}
                    </div>
                    <div class="flex items-center space-x-3">
                        <span class="px-2 py-1 text-xs font-semibold rounded-full ${statusClass}">
                            ${t.status}
                        </span>
                        <button class="delete-btn text-red-500 p-1 rounded-full hover:bg-red-100 transition duration-150" aria-label="Delete transaction" data-id="${t.id}" data-name="${t.customerName}">
                             <span class="text-xl">❌</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <details class="bg-gray-200 rounded-xl shadow-md overflow-hidden">
                <summary class="p-4 cursor-pointer font-bold text-gray-800 flex items-center justify-between hover:bg-gray-300">
                    <span>📁 ${monthYearKey} (${monthTransactions.length})</span>
                    <span class="text-sm text-gray-600">Click to view</span>
                </summary>
                <div class="pb-4 pt-1 space-y-2">
                    ${transactionListHtml}
                </div>
            </details>
        `;
    }).join('');

    if (transactions.length === 0) {
        monthFoldersHtml = `<p class="text-center text-gray-500 p-4">No deliveries have been logged yet for ${currentUserName}.</p>`; // UPDATED: Contextual message
    } else if (displayedTransactions.length === 0) {
        monthFoldersHtml = `<p class="text-center text-gray-500 p-4">No deliveries found for the selected filter period for ${currentUserName}.</p>`; // UPDATED: Contextual message
    }


    mainContent.innerHTML = `
        <div class="p-4 space-y-6">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold text-gray-800">Delivery History - ${currentUserName} (${displayedTransactions.length})</h2> </div>
            
            <div class="bg-white p-4 rounded-xl shadow-md space-y-3">
                <h3 class="font-bold text-gray-700">Filter History</h3>
                <div class="grid grid-cols-2 gap-3">
                    <input type="date" id="filter-from-date" class="filter-date-input p-2 border rounded-lg text-sm cursor-pointer" placeholder="From Date" max="${getTodayDate()}">
                    <input type="date" id="filter-to-date" class="filter-date-input p-2 border rounded-lg text-sm cursor-pointer" placeholder="To Date" value="${getTodayDate()}" max="${getTodayDate()}">
                </div>
                
                <div class="grid grid-cols-2 gap-3">
                    <button id="apply-filter-btn" class="w-full bg-blue-500 text-white py-2 rounded-xl font-semibold hover:bg-blue-600 transition duration-150">
                        Filter Records
                    </button>
                    <button id="reset-filter-btn" class="w-full bg-gray-300 text-gray-800 py-2 rounded-xl font-semibold hover:bg-gray-400 transition duration-150">
                        Reset Filter
                    </button>
                </div>
            </div>

            <!-- Option A layout: three buttons side-by-side -->
            <div class="flex justify-between items-center">
                <button id="export-btn" class="flex items-center bg-green-600 text-white px-3 py-2 rounded-xl text-sm font-semibold shadow-md hover:bg-green-700 transition duration-150" ${displayedTransactions.length === 0 ? 'disabled' : ''}>
                    <span class="text-xl mr-1">📄</span> Export My CSV
                </button>

                <button id="export-all-btn" class="flex items-center bg-purple-600 text-white px-3 py-2 rounded-xl text-sm font-semibold shadow-md hover:bg-purple-700 transition duration-150">
                    <span class="text-xl mr-1">🌍</span> Export All
                </button>

                <button id="delete-all-btn" class="flex items-center bg-red-600 text-white px-3 py-2 rounded-xl text-sm font-semibold shadow-md hover:bg-red-700 transition duration-150" ${transactions.length === 0 ? 'disabled' : ''}>
                    <span class="text-xl mr-1">🗑️</span> Delete All My Logs
                </button>
            </div>
            
            <p class="text-sm text-gray-500 italic">
                *The exported file uses the standard CSV (.csv) format. Quantity is in Millilitres (ml).
            </p>

            <div class="space-y-3" id="transactions-list">
                ${monthFoldersHtml}
            </div>
        </div>
    `;
    
    // ⬇️ FIX: Attach export button listener
    document.getElementById('export-btn')?.addEventListener('click', handleExportSpreadsheet);
    document.getElementById('export-all-btn')?.addEventListener('click', handleExportAllUsers);
    document.getElementById('delete-all-btn')?.addEventListener('click', openDeleteAllModal); 
    document.getElementById('apply-filter-btn')?.addEventListener('click', applyFilter); 
    document.getElementById('reset-filter-btn')?.addEventListener('click', () => {
        displayedTransactions = [...transactions];
        document.getElementById('filter-from-date').value = '';
        document.getElementById('filter-to-date').value = getTodayDate(); 
        renderHistoryView();
    });
    
    document.querySelectorAll('.filter-date-input').forEach(input => {
        input.addEventListener('click', (e) => {
             if (e.target.showPicker) {
                 e.target.showPicker();
             } else {
                 e.target.focus();
             }
        });
        input.addEventListener('change', (e) => {
            const TODAY_CHECK = getTodayDate();
             if (e.target.value > TODAY_CHECK) {
                 alert("Delivery date cannot be more than today's date.");
                 e.target.value = TODAY_CHECK; 
             }
        });
    });

    document.querySelectorAll('.delete-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            openDeleteModal(id, name, false);
        });
    });
}


function renderApp(view) {
    activeView = view;
    
    if (!userId) {
        mainContent.innerHTML = `<div class="p-4 text-center text-gray-500 mt-10">Authenticating...</div>`;
        return;
    }
    
    // Don't render if the name modal is open for a new user
    if (customerModal.style.display === 'flex' && !document.getElementById('add-customer-form')) {
        return; 
    }

    Object.values(navButtons).forEach(btn => {
        const isActive = btn.dataset.view === activeView;
        btn.className = isActive 
            ? 'flex flex-col items-center p-2 rounded-xl text-green-600 font-semibold transition duration-200' 
            : 'flex flex-col items-center p-2 rounded-xl text-gray-500 hover:text-green-600 transition duration-200';
    });

    if (view === 'export') {
        const fromDateInput = document.getElementById('filter-from-date');
        const toDateInput = document.getElementById('filter-to-date');
        
        if (fromDateInput && toDateInput && fromDateInput.value && toDateInput.value) {
            applyFilter();
        } else {
            displayedTransactions = [...transactions];
        }
    }
    
    switch (activeView) {
        case 'customers':
            renderCustomerView();
            break;
        case 'export':
            renderHistoryView();
            break;
        case 'log':
        default:
            renderDailyLog();
            break;
    }
}

// --- EVENT LISTENERS ---

Object.values(navButtons).forEach(btn => {
    btn.addEventListener('click', () => {
        renderApp(btn.dataset.view);
    });
});

// 1. Initial render of the header immediately on script load
renderHeader(); 

// 2. Start Firebase initialization
initFirebase();
