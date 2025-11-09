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
let userId = null;
let customers = [];
let transactions = []; // All transactions fetched from the DB
let displayedTransactions = []; // Transactions currently displayed (filtered or all)
let db = null;
let activeView = 'log'; 
let transactionToDelete = null; 
let customerToDelete = null; // ⬅️ NEW STATE for customer deletion

const QUANTITY_OPTIONS = ['250 ml', '500 ml', '1 Litre', '1.5 Litres', '2 Litres', 'Other'];
const STATUS_OPTIONS = ['Delivered', 'Not needed'];
const getTodayDate = () => new Date().toISOString().split('T')[0];
const TODAY = getTodayDate();

// --- DOM REFERENCES ---
const mainContent = document.getElementById('main-content');
const userIdDisplay = document.getElementById('user-id-display');
const navButtons = {
    log: document.getElementById('nav-log'),
    customers: document.getElementById('nav-customers'),
    export: document.getElementById('nav-history')
};
const deleteModal = document.getElementById('delete-modal');
const customerModal = document.getElementById('customer-modal'); 
const deleteAllModal = document.getElementById('delete-all-modal');
const deleteCustomerModal = document.getElementById('delete-modal'); // Reusing existing deleteModal element

// --- CORE UTILITIES ---

function getCustomerPath() {
    return userId ? `artifacts/${appId}/users/${userId}/customers` : null;
}

function getDeliveryPath() {
    return userId ? `artifacts/${appId}/users/${userId}/deliveries` : null;
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

// --- DATA LISTENERS ---

function setupCustomerListener() {
    const customerPath = getCustomerPath();
    if (!db || !customerPath) return;

    db.collection(customerPath).onSnapshot((snapshot) => {
        customers = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        renderApp(activeView);
    }, (e) => {
        console.error("Error fetching customers:", e);
    });
}

function setupDeliveryListener() {
    const deliveryPath = getDeliveryPath();
    if (!db || !deliveryPath) return;

    db.collection(deliveryPath).orderBy('timestamp', 'desc').onSnapshot((snapshot) => {
        transactions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            date: doc.data().date, // YYYY-MM-DD
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
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        console.error("Firebase libraries failed to load.");
        userIdDisplay.textContent = "Error: Firebase failed to load.";
        return;
    }

    try {
        const app = firebase.initializeApp(firebaseConfig, appId);
        const auth = app.auth();
        db = app.firestore();

        auth.onAuthStateChanged((user) => {
            if (user) {
                userId = user.uid;
                userIdDisplay.textContent = `User ID: ${userId}`;
                setupCustomerListener();
                setupDeliveryListener();
                renderApp(activeView);
            } else {
                auth.signInAnonymously()
                    .catch(e => {
                        console.error("Auth error:", e);
                        userIdDisplay.textContent = "Error: Authentication failed.";
                    });
            }
        });
    } catch (e) {
        console.error("Initialization error:", e);
        userIdDisplay.textContent = "Error: Initialization failed.";
    }
}

// --- MODAL HANDLERS (Delete Single Transaction) ---

function closeDeleteModal() {
    deleteModal.classList.add('hidden');
    deleteModal.style.display = 'none';
    transactionToDelete = null;
    customerToDelete = null; // Clear customer state too
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

// ⬅️ NEW: Handler for deleting a customer
function handleDeleteCustomer() {
    if (!db || !userId || !customerToDelete) return;

    const { id, name } = customerToDelete;

    const confirmButton = document.getElementById('modal-confirm-btn');
    confirmButton.textContent = 'Deleting...';
    confirmButton.disabled = true;

    const customerPath = getCustomerPath();
    db.collection(customerPath).doc(id).delete()
        .then(() => {
            closeDeleteModal();
            // Optional: You may want to also delete related delivery records, but for simplification, we only delete the customer here.
        })
        .catch(e => {
            console.error("Error deleting customer:", e);
            alert(`Failed to delete customer ${name}.`);
            closeDeleteModal();
        });
}

// --- MODAL HANDLERS (Delete All History) ---

function closeDeleteAllModal() {
    deleteAllModal.classList.add('hidden');
    deleteAllModal.style.display = 'none';
}

function openDeleteAllModal() {
    // Ensure the modal backdrop is visible immediately
    deleteAllModal.style.display = 'flex';
    deleteAllModal.classList.remove('hidden');

    // Inject Modal HTML
    deleteAllModal.innerHTML = `
        <div class="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-red-700">⚠️ Confirm Delete All History</h3>
                <button id="modal-close-all-btn" class="text-gray-400 hover:text-gray-600">❌</button>
            </div>
            <p class="text-gray-700 mb-6 font-semibold text-lg">Are you absolutely sure you want to permanently delete ALL (${transactions.length}) delivery records? This cannot be undone.</p>
            <div class="flex justify-end space-x-3">
                <button id="modal-cancel-all-btn" class="bg-gray-200 text-gray-800 py-2 px-4 rounded-xl font-semibold hover:bg-gray-300 transition duration-150">
                    Cancel
                </button>
                <button id="modal-confirm-all-btn" class="bg-red-600 text-white py-2 px-4 rounded-xl font-semibold shadow-md hover:bg-red-700 transition duration-150">
                    YES, Delete All History
                </button>
            </div>
        </div>
    `;

    // Attach listeners immediately after innerHTML updates
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

            alert(`Successfully deleted all ${totalRecords} history records.`);
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
    };

    const customerPath = getCustomerPath();
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
        // ⬅️ FIX 1: Load preferred quantity as default when customer changes
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
    };

    const deliveryPath = getDeliveryPath();
    db.collection(deliveryPath).add(deliveryRecord)
        .then(() => {
            alert("Delivery saved successfully!");
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

    const headers = ["Date", "Customer Name", "Quantity Delivered (ml)", "Status", "Preferred Quantity"];
    const csvContent = [headers.join(',')];

    dataToExport.forEach(t => {
        const quantityValueInML = getQuantityInML(t.quantity);
        
        const row = [
            t.dateDisplay,
            t.customerName,
            quantityValueInML, 
            t.status,
            t.actualQuantity,
        ];
        csvContent.push(row.map(item => `"${item}"`).join(','));
    });

    const blob = new Blob([csvContent.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `VarnikasDairyFarm_Deliveries_${getTodayDate()}.csv`); 
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- VIEW RENDERING (Template Functions) ---

function renderDailyLog() {
    // Determine the default selected customer ID and quantity
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
            <h2 class="text-2xl font-bold text-gray-800">Daily Milk Delivery Log</h2>
            <form id="delivery-form" class="bg-white p-5 rounded-xl shadow-lg space-y-4">
                
                <div>
                    <label htmlFor="delivery-date" class="block text-sm font-semibold text-gray-700 mb-1">Select Delivery Date</label>
                    <input
                        id="delivery-date"
                        name="delivery-date"
                        type="date"
                        value="${TODAY}"
                        max="${TODAY}" 
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
        
        // ⬅️ FIX 1: Attach customer change listener to update quantity
        document.getElementById('customer')?.addEventListener('change', handleCustomerSelectChange);
        
        const dateInput = document.getElementById('delivery-date');
        
        // Calendar Click Listener (Daily Log)
        dateInput.addEventListener('click', (e) => {
             if (e.target.showPicker) {
                 e.target.showPicker();
             } else {
                 e.target.focus();
             }
        });

        dateInput.addEventListener('change', (e) => {
             if (e.target.value > TODAY) {
                 alert("Delivery date cannot be more than today's date.");
                 e.target.value = TODAY; 
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
                </div>
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
    
    // Attach delete listeners to the new buttons
    document.querySelectorAll('.delete-customer-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            openDeleteModal(id, name, true); // Pass true to indicate customer deletion
        });
    });
}

function renderHistoryView() {
    // Group the displayed transactions by Month YYYY
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
            return `
                <div class="bg-white p-4 rounded-xl shadow-sm border-l-4 flex justify-between items-center mt-2 ml-4" style="border-color: ${color};">
                    <div>
                        <p class="text-xs text-gray-500">${t.dateDisplay}</p>
                        <p class="font-bold text-lg text-gray-800">${t.customerName}</p>
                        <p class="text-sm text-gray-600">Qty: <span class="font-bold">${t.quantity}</span></p>
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
        monthFoldersHtml = `<p class="text-center text-gray-500 p-4">No deliveries have been logged yet.</p>`;
    } else if (displayedTransactions.length === 0) {
        monthFoldersHtml = `<p class="text-center text-gray-500 p-4">No deliveries found for the selected filter period.</p>`;
    }


    mainContent.innerHTML = `
        <div class="p-4 space-y-6">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold text-gray-800">Delivery History (${displayedTransactions.length})</h2>
            </div>
            
            <div class="bg-white p-4 rounded-xl shadow-md space-y-3">
                <h3 class="font-bold text-gray-700">Filter History</h3>
                <div class="grid grid-cols-2 gap-3">
                    <input type="date" id="filter-from-date" class="filter-date-input p-2 border rounded-lg text-sm cursor-pointer" placeholder="From Date" max="${TODAY}">
                    <input type="date" id="filter-to-date" class="filter-date-input p-2 border rounded-lg text-sm cursor-pointer" placeholder="To Date" value="${TODAY}" max="${TODAY}">
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
            <div class="flex justify-between items-center">
                <button id="export-btn" class="flex items-center bg-green-600 text-white px-3 py-2 rounded-xl text-sm font-semibold shadow-md hover:bg-green-700 transition duration-150" ${displayedTransactions.length === 0 ? 'disabled' : ''}>
                    <span class="text-xl mr-1">📄</span> Export CSV
                </button>
                <button id="delete-all-btn" class="flex items-center bg-red-600 text-white px-3 py-2 rounded-xl text-sm font-semibold shadow-md hover:bg-red-700 transition duration-150" ${transactions.length === 0 ? 'disabled' : ''}>
                    <span class="text-xl mr-1">🗑️</span> Delete All
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
    
    // Attach event listeners after rendering the HTML
    document.getElementById('export-btn')?.addEventListener('click', handleExportSpreadsheet);
    document.getElementById('delete-all-btn')?.addEventListener('click', openDeleteAllModal); 
    document.getElementById('apply-filter-btn')?.addEventListener('click', applyFilter); 
    document.getElementById('reset-filter-btn')?.addEventListener('click', () => {
        displayedTransactions = [...transactions];
        document.getElementById('filter-from-date').value = '';
        document.getElementById('filter-to-date').value = TODAY;
        renderHistoryView();
    });
    
    // Calendar Click Listener (Filter Dates)
    document.querySelectorAll('.filter-date-input').forEach(input => {
        input.addEventListener('click', (e) => {
             if (e.target.showPicker) {
                 e.target.showPicker();
             } else {
                 e.target.focus();
             }
        });
    });

    document.querySelectorAll('.delete-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            openDeleteModal(id, name, false); // Delivery Deletion
        });
    });
}


function renderApp(view) {
    activeView = view;
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

initFirebase();

// --- END of MilkDelivery Portal Logic ---