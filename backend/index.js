const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const Web3 = require('web3');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider();
const secretsManager = new AWS.SecretsManager();

// Constants
const TABLE_NAME = process.env.DYNAMODB_TABLE;
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const BLOCKCHAIN_SECRETS_NAME = process.env.BLOCKCHAIN_SECRETS_NAME || 'devsecops/blockchain';

// Blockchain Configuration
let blockchainInitialized = false;
let INFURA_API_KEY = null;
let PRIVATE_KEY = null;
let CONTRACT_ADDRESS = null;
let web3 = null;
let account = null;
let contract = null;

// Contract ABI (từ ProductRegistry.sol)
const CONTRACT_ABI = [
  {
    "inputs": [{"name": "productId", "type": "string"}, {"name": "name", "type": "string"}, {"name": "batch", "type": "string"}, {"name": "manufacturer", "type": "string"}],
    "name": "registerProduct",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "productId", "type": "string"}, {"name": "newStatus", "type": "string"}],
    "name": "updateProductStatus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "productId", "type": "string"}],
    "name": "getProduct",
    "outputs": [{"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "string"}, {"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [{"indexed": false, "name": "productId", "type": "string"}, {"indexed": false, "name": "name", "type": "string"}, {"indexed": false, "name": "manufacturer", "type": "string"}],
    "name": "ProductRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{"indexed": false, "name": "productId", "type": "string"}, {"indexed": false, "name": "newStatus", "type": "string"}],
    "name": "ProductStatusUpdated",
    "type": "event"
  }
];

// User roles
const USER_ROLES = {
  CONSUMER: 'consumer',
  MANUFACTURER: 'manufacturer',
  RETAILER: 'retailer'
};

async function initializeBlockchain() {
  if (blockchainInitialized) {
    return;
  }

  try {
    console.log('Initializing blockchain configuration...');
    
    const response = await secretsManager.getSecretValue({
      SecretId: BLOCKCHAIN_SECRETS_NAME
    }).promise();
    
    const secrets = JSON.parse(response.SecretString);
    
    INFURA_API_KEY = secrets.INFURA_API_KEY;
    PRIVATE_KEY = secrets.PRIVATE_KEY;
    CONTRACT_ADDRESS = secrets.CONTRACT_ADDRESS;
    
    // Validate required secrets
    if (!INFURA_API_KEY || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
      console.error('Missing blockchain configuration:', {
        infura: !!INFURA_API_KEY,
        privateKey: !!PRIVATE_KEY,
        contract: !!CONTRACT_ADDRESS
      });
      throw new Error('Missing required blockchain configuration');
    }
    
    // Initialize Web3 with v1.x syntax
    const providerUrl = `https://sepolia.infura.io/v3/${INFURA_API_KEY}`;
    web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));
    
    // Ensure private key format
    const formattedPrivateKey = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : '0x' + PRIVATE_KEY;
    
    // Initialize account with Web3 v1.x
    account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;
    
    // Test connection
    const networkId = await web3.eth.net.getId();
    console.log('Connected to network:', networkId);
    
    // Check balance
    const balance = await web3.eth.getBalance(account.address);
    console.log('Account balance:', web3.utils.fromWei(balance, 'ether'), 'ETH');
    
    if (parseFloat(web3.utils.fromWei(balance, 'ether')) < 0.001) {
      console.warn('⚠️  Low account balance, transactions may fail');
    }
    
    // Initialize contract
    contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
    
    blockchainInitialized = true;
    console.log('✅ Blockchain initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize blockchain:', error);
    // Don't throw error, allow app to continue without blockchain
    console.warn('⚠️  Continuing without blockchain functionality');
    blockchainInitialized = false;
  }
}

// ===== BLOCKCHAIN INTEGRATION FUNCTIONS (FIXED) =====

async function registerProductOnBlockchain(productId, name, batch, manufacturer) {
  try {
    console.log('🔗 Registering product on blockchain:', { productId, name, batch, manufacturer });
    
    // Ensure all parameters are strings and properly formatted
    const params = [
      String(productId).trim(),
      String(name).trim(), 
      String(batch).trim(),
      String(manufacturer).trim()
    ];
    
    // Get current gas price and convert properly
    const gasPrice = await web3.eth.getGasPrice();
    console.log('⛽ Current gas price:', gasPrice);
    
    // Estimate gas with error handling
    let gasEstimate;
    try {
      gasEstimate = await contract.methods.registerProduct(...params).estimateGas({
        from: account.address
      });
      console.log('📊 Gas estimate:', gasEstimate);
    } catch (estimateError) {
      console.warn('⚠️  Gas estimation failed, using default:', estimateError.message);
      gasEstimate = 300000; // Safe default
    }
    
    // Build transaction options with proper number conversion
    const txOptions = {
      from: account.address,
      gas: Math.floor(Number(gasEstimate) * 1.2), // Add 20% buffer and ensure integer
      gasPrice: String(gasPrice) // Keep as string to avoid BigInt issues
    };
    
    console.log('📝 Transaction options:', txOptions);
    
    // Send transaction with Web3 v1.x syntax
    const tx = await contract.methods.registerProduct(...params).send(txOptions);
    
    console.log('✅ Product registered on blockchain:', tx.transactionHash);
    return tx.transactionHash;
    
  } catch (error) {
    console.error('❌ Blockchain registration error:', error);
    
    // Provide more specific error messages
    if (error.message.includes('insufficient funds')) {
      throw new Error('Insufficient funds for blockchain transaction');
    } else if (error.message.includes('gas')) {
      throw new Error('Gas estimation failed - network may be congested');
    } else if (error.message.includes('revert')) {
      throw new Error('Smart contract rejected transaction - product may already exist');
    } else if (error.message.includes('nonce')) {
      throw new Error('Transaction nonce error - please try again');
    } else {
      throw new Error('Blockchain transaction failed: ' + error.message);
    }
  }
}

async function updateProductStatusOnBlockchain(productId, status) {
  try {
    console.log('🔄 Updating product status on blockchain:', { productId, status });
    
    const params = [String(productId).trim(), String(status).trim()];
    
    // Get gas price
    const gasPrice = await web3.eth.getGasPrice();
    
    // Estimate gas
    let gasEstimate;
    try {
      gasEstimate = await contract.methods.updateProductStatus(...params).estimateGas({
        from: account.address
      });
    } catch (estimateError) {
      console.warn('⚠️  Gas estimation failed for status update:', estimateError.message);
      gasEstimate = 200000; // Safe default for status update
    }
    
    const txOptions = {
      from: account.address,
      gas: Math.floor(Number(gasEstimate) * 1.2),
      gasPrice: String(gasPrice)
    };
    
    const tx = await contract.methods.updateProductStatus(...params).send(txOptions);
    
    console.log('✅ Product status updated on blockchain:', tx.transactionHash);
    return tx.transactionHash;
    
  } catch (error) {
    console.error('❌ Blockchain status update error:', error);
    
    if (error.message.includes('revert')) {
      throw new Error('Product not found on blockchain or unauthorized access');
    } else if (error.message.includes('insufficient funds')) {
      throw new Error('Insufficient funds for blockchain transaction');
    } else {
      throw new Error('Failed to update product status on blockchain: ' + error.message);
    }
  }
}

async function getProductFromBlockchain(productId) {
  try {
    console.log('🔍 Reading product from blockchain:', productId);
    
    const result = await contract.methods.getProduct(String(productId).trim()).call();
    
    // Handle the returned array properly
    if (!result || result.length < 5) {
      console.log('📭 Product not found on blockchain');
      return null;
    }
    
    // Check if product exists (name should not be empty)
    if (!result[0] || result[0] === '') {
      console.log('📭 Empty product data on blockchain');
      return null;
    }
    
    return {
      name: String(result[0] || ''),
      batch: String(result[1] || ''),
      manufacturer: String(result[2] || ''),
      status: String(result[3] || 'Created'),
      timestamp: result[4] ? parseInt(result[4]) : 0
    };
    
  } catch (error) {
    console.error('❌ Blockchain read error:', error);
    
    if (error.message.includes('revert') || error.message.includes('not found')) {
      console.log('📭 Product not found on blockchain');
      return null;
    }
    
    // Don't throw error for read operations, just return null
    console.warn('⚠️  Failed to read from blockchain, returning null');
    return null;
  }
}

// ===== USER AUTHENTICATION & ROLE MANAGEMENT =====

async function getUserProfileWithRole(userId) {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: 'PROFILE'
      }
    };

    const result = await dynamoDB.get(params).promise();
    
    if (!result.Item) {
      // Create default user profile if doesn't exist
      const defaultUser = {
        userId: userId,
        username: "user_" + userId.substring(0, 8),
        role: USER_ROLES.CONSUMER,
        createdAt: new Date().toISOString()
      };
      
      // Save default profile to DynamoDB
      await dynamoDB.put({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          GSI1PK: 'TYPE#USER',
          GSI1SK: defaultUser.username,
          ...defaultUser,
          updatedAt: defaultUser.createdAt
        }
      }).promise();
      
      console.log('Created default user profile for:', userId);
      return defaultUser;
    }
    
    return {
      userId: result.Item.userId,
      username: result.Item.username,
      email: result.Item.email,
      name: result.Item.name,
      role: result.Item.role,
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt
    };
  } catch (error) {
    console.error('Error getting user profile:', error);
    // Return default user if there's an error
    return {
      userId: userId,
      username: "user_" + userId.substring(0, 8),
      role: USER_ROLES.CONSUMER
    };
  }
}

function hasRole(userRole, allowedRoles) {
  return allowedRoles.includes(userRole);
}

const originalHandler = async (event) => {
  console.log('🚀 API Gateway Event:', JSON.stringify(event, null, 2));

  // Initialize blockchain (with fallback)
  await initializeBlockchain();

  try {
    const { requestContext, pathParameters, queryStringParameters, body } = event;
    
    const httpMethod = event.httpMethod || (event.requestContext?.http?.method);
    const routeKey = event.routeKey || `${httpMethod} ${event.resource}`;
    const path = event.path || event.resource || routeKey?.split(' ')[1];
    
    // Extract user ID from Cognito JWT token
    let userId = null;
    let userProfile = null;
    let userRole = null;
    
    // Check if route requires authentication
    const publicRoutes = ['/health', '/public/verify', '/public/trace'];
    const isPublicRoute = publicRoutes.some(route => path.includes(route)) || httpMethod === 'OPTIONS';
    
    if (!isPublicRoute) {
      // Extract user ID from JWT claims
      if (requestContext?.authorizer?.jwt?.claims?.sub) {
        userId = requestContext.authorizer.jwt.claims.sub;
      } else if (requestContext?.authorizer?.claims?.sub) {
        userId = requestContext.authorizer.claims.sub;
      }
      
      if (!userId) {
        return formatResponse(401, { message: 'Unauthorized: Missing user ID' });
      }
      
      // Get user profile and role from DynamoDB
      userProfile = await getUserProfileWithRole(userId);
      userRole = userProfile.role;
      
      console.log('👤 User authenticated:', {
        userId: userId,
        username: userProfile.username,
        role: userRole
      });
    }
    
    const parsedBody = body ? (typeof body === 'string' ? JSON.parse(body) : body) : {};

    let response;
    
    // Health Check Route
    if (path === '/health' && httpMethod === 'GET') {
      response = await healthCheck();
    }
    
    // CORS Options Route
    else if (httpMethod === 'OPTIONS') {
      return formatResponse(200, { message: 'CORS OK' });
    }
    
    // Public Routes (No Authentication)
    else if (path === '/public/verify' && httpMethod === 'GET') {
      const productCode = queryStringParameters?.code;
      response = await verifyProductOnBlockchain(productCode);
    }
    else if (path === '/public/trace' && httpMethod === 'GET') {
      const productCode = queryStringParameters?.code;
      response = await traceProductWithBlockchain(productCode);
    }
    
    // User Management Routes
    else if (path === '/users/me' && httpMethod === 'GET') {
      response = userProfile;
    }
    else if (path === '/users/update-role' && httpMethod === 'POST') {
      response = await updateUserRole(userId, parsedBody);
    }
    
    // Product Management Routes with Role Checking
    else if (path === '/products' && httpMethod === 'GET') {
      response = await getProducts(userId, userRole, queryStringParameters);
    }
    else if (path === '/products' && httpMethod === 'POST') {
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER])) {
        return formatResponse(403, { message: 'Only manufacturers can create products' });
      }
      response = await createProductWithBlockchain(userId, userProfile, parsedBody);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'GET') {
      const productId = pathParameters?.id;
      response = await getProductWithBlockchain(userId, userRole, productId);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'PUT') {
      const productId = pathParameters?.id;
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER])) {
        return formatResponse(403, { message: 'Only manufacturers can update products' });
      }
      response = await updateProductWithBlockchain(userId, userRole, productId, parsedBody);
    }
    else if (path?.startsWith('/products/') && httpMethod === 'DELETE') {
      const productId = pathParameters?.id;
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER])) {
        return formatResponse(403, { message: 'Only manufacturers can delete products' });
      }
      response = await deleteProduct(userId, userRole, productId);
    }
    
    // Blockchain Verification Routes
    else if (path === '/verify' && httpMethod === 'GET') {
      const productCode = queryStringParameters?.code;
      response = await verifyProductOnBlockchain(productCode);
    }
    
    // Order Management Routes with Role Checking
    else if (path === '/orders' && httpMethod === 'GET') {
      response = await getOrders(userId, userRole, queryStringParameters);
    }
    else if (path === '/orders' && httpMethod === 'POST') {
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER, USER_ROLES.RETAILER])) {
        return formatResponse(403, { message: 'Only manufacturers and retailers can create orders' });
      }
      response = await createOrderWithBlockchain(userId, userProfile, parsedBody);
    }
    else if (path?.startsWith('/orders/') && httpMethod === 'PUT') {
      const orderId = pathParameters?.id;
      if (!hasRole(userRole, [USER_ROLES.MANUFACTURER, USER_ROLES.RETAILER])) {
        return formatResponse(403, { message: 'Only manufacturers and retailers can update orders' });
      }
      response = await updateOrderStatusWithBlockchain(userId, userRole, orderId, parsedBody);
    }
    
    // Traceability Routes
    else if (path === '/trace' && httpMethod === 'GET') {
      const productCode = queryStringParameters?.code;
      response = await traceProductWithBlockchain(productCode);
    }
    
    // Company listing routes
    else if (path === '/manufacturers' && httpMethod === 'GET') {
      response = await getManufacturers();
    }
    else if (path === '/retailers' && httpMethod === 'GET') {
      response = await getRetailers();
    }
    
    else {
      return formatResponse(404, { message: 'Route not found', path: path, method: httpMethod });
    }

    return formatResponse(200, response);
  } catch (error) {
    console.error('❌ Handler Error:', error);
    
    if (error.code === 'ConditionalCheckFailedException') {
      return formatResponse(400, { message: 'Item does not exist or you do not have permission' });
    }
    
    return formatResponse(500, { 
      message: 'Internal server error', 
      error: error.message,
      blockchain: blockchainInitialized ? 'connected' : 'disconnected'
    });
  }
};

exports.handler = async (event, context) => {
  // Handle Cognito Triggers
  if (event.triggerSource && event.version) {
    console.log('🔐 Cognito Trigger Event:', JSON.stringify(event, null, 2));
    return handleCognitoTrigger(event, context);
  }
  
  return originalHandler(event);
};

// ===== PRODUCT MANAGEMENT FUNCTIONS (IMPROVED) =====

async function createProductWithBlockchain(userId, userProfile, productData) {
  const { name, category, description, quantity = 0, price = 0, batch } = productData;
  
  if (!name || !category || !batch) {
    throw new Error('Product name, category, and batch are required');
  }
  
  const productId = uuidv4();
  const timestamp = new Date().toISOString();
  
  let txHash = null;
  let blockchainStatus = 'pending';
  
  try {
    if (blockchainInitialized) {
      console.log('🔗 Attempting blockchain registration...');
      // Try to register on blockchain
      txHash = await registerProductOnBlockchain(
        productId, 
        name, 
        batch, 
        userProfile.name || userProfile.username
      );
      blockchainStatus = 'registered';
      console.log('✅ Blockchain registration successful');
    } else {
      console.warn('⚠️  Blockchain not initialized, creating product without blockchain registration');
      blockchainStatus = 'not_registered';
    }
  } catch (blockchainError) {
    console.error('❌ Blockchain registration failed:', blockchainError);
    // Continue without blockchain registration
    blockchainStatus = 'failed';
    console.log('📝 Continuing with database-only product creation...');
  }
  
  // Save to DynamoDB regardless of blockchain status
  const productItem = {
    PK: `USER#${userId}`,
    SK: `PRODUCT#${productId}`,
    GSI1PK: 'TYPE#PRODUCT',
    GSI1SK: `${category}#${name}`,
    productId,
    name,
    category,
    description,
    batch,
    quantity: parseInt(quantity) || 0,
    price: parseInt(price) || 0,
    manufacturer: userProfile.name || userProfile.username,
    manufacturerId: userId,
    blockchainTxHash: txHash,
    blockchainStatus: blockchainStatus,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  
  await dynamoDB.put({
    TableName: TABLE_NAME,
    Item: productItem
  }).promise();
  
  const message = txHash 
    ? 'Product created and registered on blockchain successfully'
    : `Product created successfully (blockchain status: ${blockchainStatus})`;
  
  return {
    message,
    product: {
      id: productId,
      name,
      category,
      description,
      batch,
      quantity: parseInt(quantity) || 0,
      price: parseInt(price) || 0,
      manufacturer: userProfile.name || userProfile.username,
      blockchainTxHash: txHash,
      blockchainStatus: blockchainStatus,
      createdAt: timestamp
    }
  };
}

// ===== REST OF THE FUNCTIONS (keeping existing implementations) =====

async function updateUserRole(userId, requestBody) {
  try {
    const { role } = requestBody;
    
    if (!Object.values(USER_ROLES).includes(role)) {
      throw new Error('Invalid role');
    }
    
    const timestamp = new Date().toISOString();
    
    // Update in DynamoDB
    await dynamoDB.update({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: 'PROFILE'
      },
      UpdateExpression: 'SET #role = :role, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#role': 'role'
      },
      ExpressionAttributeValues: {
        ':role': role,
        ':updatedAt': timestamp
      }
    }).promise();
    
    return {
      message: 'User role updated successfully',
      role: role
    };
    
  } catch (error) {
    console.error('Error updating user role:', error);
    throw new Error('Could not update user role');
  }
}

async function getProducts(userId, userRole, queryParams) {
  const scope = queryParams?.scope || 'all';
  let params;
  
  if (scope === 'personal' && userRole === USER_ROLES.MANUFACTURER) {
    params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'PRODUCT#'
      }
    };
  } else {
    params = {
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'TYPE#PRODUCT'
      }
    };
  }
  
  const result = await dynamoDB.query(params).promise();
  
  const products = result.Items.map(item => ({
    id: item.productId || item.SK.split('#')[1],
    name: item.name,
    category: item.category,
    description: item.description,
    batch: item.batch,
    quantity: item.quantity || 0,
    price: item.price || 0,
    manufacturer: item.manufacturer || item.manufacturerName,
    manufacturerId: item.manufacturerId,
    blockchainTxHash: item.blockchainTxHash,
    blockchainStatus: item.blockchainStatus,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
  
  return { products };
}

async function getProductWithBlockchain(userId, userRole, productId) {
  if (!productId) {
    throw new Error('Product ID is required');
  }
  
  let params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: 'productId = :productId',
    ExpressionAttributeValues: {
      ':pk': 'TYPE#PRODUCT',
      ':productId': productId
    }
  };
  
  const result = await dynamoDB.query(params).promise();
  
  if (result.Items.length > 0) {
    const item = result.Items[0];
    
    // Get blockchain data for verification
    const blockchainData = await getProductFromBlockchain(productId);
    
    return {
      id: item.productId,
      name: item.name,
      category: item.category,
      description: item.description,
      batch: item.batch,
      quantity: item.quantity,
      price: item.price,
      manufacturer: item.manufacturer,
      manufacturerId: item.manufacturerId,
      blockchainTxHash: item.blockchainTxHash,
      blockchainData: blockchainData,
      blockchainVerified: blockchainData ? true : false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }
  
  throw new Error('Product not found');
}

async function updateProductWithBlockchain(userId, userRole, productId, updateData) {
  const { status } = updateData;
  
  if (status) {
    try {
      const txHash = await updateProductStatusOnBlockchain(productId, status);
      
      await dynamoDB.update({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `PRODUCT#${productId}`
        },
        UpdateExpression: 'SET blockchainStatus = :status, lastBlockchainTxHash = :txHash, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':status': status,
          ':txHash': txHash,
          ':updatedAt': new Date().toISOString()
        },
        ConditionExpression: 'attribute_exists(PK)'
      }).promise();
      
      return { 
        message: 'Product status updated on blockchain successfully',
        blockchainTxHash: txHash
      };
    } catch (error) {
      throw new Error('Failed to update product status: ' + error.message);
    }
  }
  
  return { message: 'Product updated successfully' };
}

async function deleteProduct(userId, userRole, productId) {
  await dynamoDB.delete({
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${userId}`,
      SK: `PRODUCT#${productId}`
    },
    ConditionExpression: 'attribute_exists(PK)'
  }).promise();
  
  return { message: 'Product deleted successfully' };
}

async function getOrders(userId, userRole, queryParams) {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'ORDER#'
    }
  };
  
  const result = await dynamoDB.query(params).promise();
  
  const orders = result.Items.map(item => ({
    id: item.orderId || item.SK.split('#')[1],
    type: item.type,
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
  
  return { orders };
}

async function createOrderWithBlockchain(userId, userProfile, orderData) {
  // Simplified order creation
  const orderId = uuidv4();
  const timestamp = new Date().toISOString();
  
  const orderItem = {
    PK: `USER#${userId}`,
    SK: `ORDER#${orderId}`,
    orderId,
    ...orderData,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  
  await dynamoDB.put({
    TableName: TABLE_NAME,
    Item: orderItem
  }).promise();
  
  return {
    message: 'Order created successfully',
    order: orderItem
  };
}

async function updateOrderStatusWithBlockchain(userId, userRole, orderId, updateData) {
  const { status } = updateData;
  
  await dynamoDB.update({
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${userId}`,
      SK: `ORDER#${orderId}`
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':updatedAt': new Date().toISOString()
    },
    ConditionExpression: 'attribute_exists(PK)'
  }).promise();
  
  return { message: 'Order status updated successfully' };
}

async function verifyProductOnBlockchain(productCode) {
  if (!productCode) {
    throw new Error('Product code is required');
  }
  
  try {
    // Get product from blockchain
    const blockchainData = await getProductFromBlockchain(productCode);
    
    if (!blockchainData) {
      return {
        verified: false,
        message: 'Product not found on blockchain'
      };
    }
    
    // Get additional data from DynamoDB
    try {
      const dbProduct = await getProductWithBlockchain(null, null, productCode);
      return {
        verified: true,
        productId: productCode,
        blockchainData: blockchainData,
        databaseData: dbProduct,
        verificationTime: new Date().toISOString()
      };
    } catch (dbError) {
      // Product exists on blockchain but not in database
      return {
        verified: true,
        productId: productCode,
        blockchainData: blockchainData,
        databaseData: null,
        verificationTime: new Date().toISOString(),
        note: 'Product verified on blockchain but not found in database'
      };
    }
  } catch (error) {
    return {
      verified: false,
      message: error.message,
      productId: productCode
    };
  }
}

async function traceProductWithBlockchain(productCode) {
  if (!productCode) {
    throw new Error('Product code is required');
  }
  
  try {
    // Get blockchain verification
    const verification = await verifyProductOnBlockchain(productCode);
    
    if (!verification.verified) {
      throw new Error('Product not found or invalid');
    }
    
    // Get trace records from DynamoDB
    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `PRODUCT#${productCode}`
      },
      ScanIndexForward: true
    };
    
    const result = await dynamoDB.query(params).promise();
    
    const traceRecords = result.Items
      .filter(item => item.SK.startsWith('TRACE#'))
      .map(item => ({
        stage: item.stage,
        company: item.companyName,
        date: item.timestamp?.split('T')[0] || item.createdAt?.split('T')[0],
        location: item.details?.location || 'N/A',
        details: item.details?.notes || `${item.stage} - Quantity: ${item.details?.quantity || 'N/A'}`,
        blockchainTxHash: item.blockchainTxHash || 'N/A'
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    return {
      productId: productCode,
      productName: verification.blockchainData.name,
      manufacturer: verification.blockchainData.manufacturer,
      batch: verification.blockchainData.batch,
      currentStatus: verification.blockchainData.status,
      blockchainVerified: true,
      blockchainTimestamp: verification.blockchainData.timestamp,
      trace: traceRecords
    };
  } catch (error) {
    throw new Error('Failed to trace product: ' + error.message);
  }
}

async function getManufacturers() {
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#role = :role',
    ExpressionAttributeNames: {
      '#role': 'role'
    },
    ExpressionAttributeValues: {
      ':pk': 'TYPE#USER',
      ':role': USER_ROLES.MANUFACTURER
    }
  };
  
  try {
    const result = await dynamoDB.query(params).promise();
    
    const manufacturers = await Promise.all(result.Items.map(async (item) => {
      // Count products for each manufacturer
      try {
        const productCount = await dynamoDB.query({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `USER#${item.userId}`,
            ':sk': 'PRODUCT#'
          },
          Select: 'COUNT'
        }).promise();
        
        return {
          id: item.userId,
          name: item.name || item.username,
          location: item.location || 'Việt Nam',
          products: productCount.Count,
          rating: 4.5, // Mock rating for now
          email: item.email
        };
      } catch (countError) {
        console.warn('Failed to count products for manufacturer:', item.userId);
        return {
          id: item.userId,
          name: item.name || item.username,
          location: item.location || 'Việt Nam',
          products: 0,
          rating: 4.5,
          email: item.email
        };
      }
    }));
    
    return { manufacturers };
  } catch (error) {
    console.error('Error getting manufacturers:', error);
    return { manufacturers: [] };
  }
}

async function getRetailers() {
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#role = :role',
    ExpressionAttributeNames: {
      '#role': 'role'
    },
    ExpressionAttributeValues: {
      ':pk': 'TYPE#USER',
      ':role': USER_ROLES.RETAILER
    }
  };
  
  try {
    const result = await dynamoDB.query(params).promise();
    
    const retailers = result.Items.map(item => ({
      id: item.userId,
      name: item.name || item.username,
      location: item.location || 'Việt Nam',
      manufacturers: 5, // Mock count for now
      rating: 4.3, // Mock rating for now
      email: item.email
    }));
    
    return { retailers };
  } catch (error) {
    console.error('Error getting retailers:', error);
    return { retailers: [] };
  }
}

// ===== UTILITY FUNCTIONS =====

async function healthCheck() {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    blockchain: {
      connected: blockchainInitialized,
      network: 'Sepolia',
      contract: CONTRACT_ADDRESS || 'not-configured',
      account: account?.address || 'not-configured'
    },
    database: {
      connected: TABLE_NAME ? true : false,
      table: TABLE_NAME || 'not-configured'
    },
    environment: {
      infura_configured: INFURA_API_KEY ? true : false,
      private_key_configured: PRIVATE_KEY ? true : false,
      contract_configured: CONTRACT_ADDRESS ? true : false,
      cognito_configured: USER_POOL_ID ? true : false,
      region: REGION
    }
  };
}

async function handleCognitoTrigger(event, context) {
  try {
    if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
      const { userPoolId, userName, request } = event;
      const { userAttributes } = request;
      
      console.log('Processing Post Confirmation for user:', userName);
      
      const timestamp = new Date().toISOString();
      const email = userAttributes.email;
      const username = userAttributes.preferred_username || email.split('@')[0];
      
      await dynamoDB.put({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userAttributes.sub}`,
          SK: 'PROFILE',
          GSI1PK: 'TYPE#USER',
          GSI1SK: username,
          userId: userAttributes.sub,
          username: username,
          email: email,
          name: userAttributes.name || username,
          role: USER_ROLES.CONSUMER, // Default role
          createdAt: timestamp,
          updatedAt: timestamp
        }
      }).promise();
      
      console.log('User profile saved to DynamoDB successfully');
    }
    
    return event;
  } catch (error) {
    console.error('Error handling Cognito Trigger:', error);
    return event;
  }
}

function formatResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    },
    body: JSON.stringify(body)
  };
}