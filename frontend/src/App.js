import React, { useState, useEffect } from 'react';
import { 
  Menu, LogOut, PlusCircle, Trash2, Edit, Eye, Package, 
  ShoppingCart, TruckIcon, Store, User, Users, Phone, 
  Info, Search, QrCode, MapPin, Calendar, BarChart3,
  Home, X, Check, AlertCircle, Building2, ArrowRight,
  RefreshCw, ExternalLink
} from 'lucide-react';

// Cấu hình
const TOKEN_KEY = 'traceability_token';
const USER_KEY = 'traceability_user';
const API_URL = window.env?.API_URL || 'https://vvbcaer9bc.execute-api.ap-southeast-1.amazonaws.com';
const COGNITO_DOMAIN = 'https://ap-southeast-15bnoogi8v.auth.ap-southeast-1.amazoncognito.com';
const CLIENT_ID = '2qkqfoug89p9qhfggcsflg4m24';
const REDIRECT_URI = window.location.origin;

// Định nghĩa các vai trò người dùng (theo backend)
const USER_ROLES = {
  CONSUMER: 'consumer',
  MANUFACTURER: 'manufacturer', 
  RETAILER: 'retailer'
};

export default function ProductTraceabilityApp() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState('');
  const [apiLoading, setApiLoading] = useState(false);
  
  // States cho dữ liệu thực từ API
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [traceData, setTraceData] = useState(null);
  const [manufacturers, setManufacturers] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [healthData, setHealthData] = useState(null);
  
  // States cho forms
  const [productForm, setProductForm] = useState({
    name: '',
    category: '',
    description: '',
    quantity: 0,
    price: 0,
    batch: '',
    blockchainStatus: 'pending'
  });
  const [orderForm, setOrderForm] = useState({
    type: 'export',
    productId: '',
    quantity: 0,
    recipientId: '',
    recipientName: '',
    supplierName: '',
    customerInfo: '',
    notes: ''
  });
  const [searchCode, setSearchCode] = useState('');
  const [editingItem, setEditingItem] = useState(null);

  // Xử lý đăng nhập và authentication
  useEffect(() => {
    if (window.location.hash && window.location.hash.includes('id_token')) {
      handleCognitoCallback();
    } else {
      const token = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);
      
      if (token && savedUser) {
        try {
          const userData = JSON.parse(savedUser);
          setUser(userData);
          // Load dữ liệu từ API
          loadInitialData(token);
        } catch (e) {
          console.error('Error parsing saved user data:', e);
          logout();
        }
      }
      setLoading(false);
    }
  }, []);

  const handleCognitoCallback = async () => {
    try {
      setLoading(true);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const idToken = hashParams.get('id_token');
      const accessToken = hashParams.get('access_token');
      
      if (idToken && accessToken) {
        const payload = parseJwt(idToken);
        localStorage.setItem(TOKEN_KEY, accessToken);
        
        const userData = {
          userId: payload.sub,
          username: payload.preferred_username || payload['cognito:username'] || payload.email.split('@')[0],
          email: payload.email,
          name: payload.name || payload.preferred_username || payload.email.split('@')[0]
        };
        
        // Gọi API để lấy thông tin user profile (có role)
        const userProfile = await fetchUserProfile(accessToken);
        const completeUserData = { ...userData, ...userProfile };
        
        localStorage.setItem(USER_KEY, JSON.stringify(completeUserData));
        setUser(completeUserData);
        
        // Load dữ liệu ban đầu
        await loadInitialData(accessToken);
        
        window.history.replaceState({}, document.title, window.location.pathname);
        showNotification(`Đăng nhập thành công với vai trò ${getRoleDisplayName(completeUserData.role)}!`);
      }
    } catch (error) {
      console.error('Error processing Cognito callback:', error);
      setError('Đã xảy ra lỗi trong quá trình đăng nhập.');
    } finally {
      setLoading(false);
    }
  };

  // API Functions
  const apiCall = async (endpoint, options = {}) => {
    const token = localStorage.getItem(TOKEN_KEY);
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers
      },
      ...options
    };

    try {
      const response = await fetch(`${API_URL}${endpoint}`, config);
      
      if (response.status === 401) {
        // Token expired
        logout();
        throw new Error('Phiên đăng nhập hết hạn');
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`API call failed for ${endpoint}:`, error);
      throw error;
    }
  };

  const fetchUserProfile = async (token = null) => {
    try {
      if (token) {
        // Temporarily store token for this call
        const originalToken = localStorage.getItem(TOKEN_KEY);
        localStorage.setItem(TOKEN_KEY, token);
        const profile = await apiCall('/users/me');
        if (originalToken) {
          localStorage.setItem(TOKEN_KEY, originalToken);
        }
        return profile;
      }
      return await apiCall('/users/me');
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return { role: USER_ROLES.CONSUMER }; // Default role
    }
  };

  const loadInitialData = async (token = null) => {
    try {
      setApiLoading(true);
      
      // Health check
      try {
        const health = await apiCall('/health');
        setHealthData(health);
      } catch (err) {
        console.warn('Health check failed:', err);
      }

      // Load manufacturers and retailers for all users
      try {
        const [manufacturersData, retailersData] = await Promise.all([
          apiCall('/manufacturers'),
          apiCall('/retailers')
        ]);
        setManufacturers(manufacturersData.manufacturers || []);
        setRetailers(retailersData.retailers || []);
      } catch (err) {
        console.warn('Error loading companies:', err);
      }

      // Load user-specific data
      const currentUser = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
      if (currentUser.role) {
        try {
          if (currentUser.role === USER_ROLES.MANUFACTURER || currentUser.role === USER_ROLES.RETAILER) {
            const productsData = await apiCall('/products?scope=personal');
            setProducts(productsData.products || []);
          } else {
            const productsData = await apiCall('/products?scope=all');
            setProducts(productsData.products || []);
          }
          
          if (currentUser.role === USER_ROLES.MANUFACTURER || currentUser.role === USER_ROLES.RETAILER) {
            const ordersData = await apiCall('/orders');
            setOrders(ordersData.orders || []);
          }
        } catch (err) {
          console.warn('Error loading user data:', err);
        }
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setApiLoading(false);
    }
  };

  const parseJwt = (token) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      throw new Error('Invalid token format');
    }
  };

  const login = () => {
    const cognitoLoginUrl = `${COGNITO_DOMAIN}/login?client_id=${CLIENT_ID}&response_type=token&scope=email+openid+phone&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    window.location.href = cognitoLoginUrl;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setProducts([]);
    setOrders([]);
    setManufacturers([]);
    setRetailers([]);
    setHealthData(null);
  };

  // Role Guard Component
  const RoleGuard = ({ allowedRoles, children, fallback = null }) => {
    if (!user || !allowedRoles.includes(user.role)) {
      return fallback || (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-red-800 mb-2">
            Không có quyền truy cập
          </h3>
          <p className="text-red-600">
            Bạn không có quyền truy cập chức năng này với vai trò hiện tại: {getRoleDisplayName(user?.role)}
          </p>
        </div>
      );
    }
    return children;
  };

  // Hàm helper để hiển thị tên role
  const getRoleDisplayName = (role) => {
    switch (role) {
      case USER_ROLES.CONSUMER: return 'Người tiêu dùng';
      case USER_ROLES.MANUFACTURER: return 'Nhà sản xuất';
      case USER_ROLES.RETAILER: return 'Nhà bán lẻ';
      default: return 'Người dùng';
    }
  };

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  const showError = (message) => {
    setError(message);
    setTimeout(() => setError(''), 5000);
  };

  // Product management functions
  const addProduct = async () => {
    if (!productForm.name || !productForm.category || !productForm.batch) {
      showError('Vui lòng điền đầy đủ thông tin sản phẩm (Tên, Danh mục, Batch)');
      return;
    }

    try {
      setApiLoading(true);
      const result = await apiCall('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: productForm.name,
          category: productForm.category,
          description: productForm.description,
          quantity: parseInt(productForm.quantity) || 0,
          price: parseInt(productForm.price) || 0,
          batch: productForm.batch
        })
      });
      
      showNotification(result.message || 'Thêm sản phẩm thành công!');
      setProductForm({ 
        name: '', 
        category: '', 
        description: '', 
        quantity: 0, 
        price: 0, 
        batch: '',
        blockchainStatus: 'pending'
      });
      
      // Reload products
      await loadProducts();
      setActiveTab('dashboard');
    } catch (error) {
      showError('Lỗi khi thêm sản phẩm: ' + error.message);
    } finally {
      setApiLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const scope = user?.role === USER_ROLES.MANUFACTURER ? 'personal' : 'all';
      const productsData = await apiCall(`/products?scope=${scope}`);
      setProducts(productsData.products || []);
    } catch (error) {
      console.error('Error loading products:', error);
    }
  };

  const updateProduct = async () => {
    try {
      setApiLoading(true);
      await apiCall(`/products/${editingItem.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingItem)
      });
      
      showNotification('Cập nhật sản phẩm thành công!');
      setEditingItem(null);
      await loadProducts();
    } catch (error) {
      showError('Lỗi khi cập nhật sản phẩm: ' + error.message);
    } finally {
      setApiLoading(false);
    }
  };

  const deleteProduct = async (productId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa sản phẩm này?')) return;

    try {
      setApiLoading(true);
      await apiCall(`/products/${productId}`, {
        method: 'DELETE'
      });
      
      showNotification('Xóa sản phẩm thành công!');
      await loadProducts();
    } catch (error) {
      showError('Lỗi khi xóa sản phẩm: ' + error.message);
    } finally {
      setApiLoading(false);
    }
  };

  // Order management functions
  const addOrder = async (type) => {
    if (!orderForm.productId || !orderForm.quantity) {
      showError('Vui lòng điền đầy đủ thông tin đơn hàng');
      return;
    }

    try {
      setApiLoading(true);
      const orderData = {
        type,
        productId: orderForm.productId,
        quantity: parseInt(orderForm.quantity),
        notes: orderForm.notes
      };

      // Add type-specific fields
      if (type === 'export') {
        orderData.recipientId = orderForm.recipientId;
        orderData.recipientName = orderForm.recipientName;
      } else if (type === 'import') {
        orderData.recipientId = orderForm.recipientId; // This is actually supplierId
        orderData.supplierName = orderForm.supplierName;
      } else if (type === 'sale') {
        orderData.customerInfo = orderForm.customerInfo;
      }

      const result = await apiCall('/orders', {
        method: 'POST',
        body: JSON.stringify(orderData)
      });
      
      showNotification(result.message || `Tạo đơn hàng ${type === 'export' ? 'xuất' : type === 'import' ? 'nhập' : 'bán'} thành công!`);
      setOrderForm({
        type: 'export',
        productId: '',
        quantity: 0,
        recipientId: '',
        recipientName: '',
        supplierName: '',
        customerInfo: '',
        notes: ''
      });
      
      // Reload orders
      await loadOrders();
      setActiveTab(type);
    } catch (error) {
      showError('Lỗi khi tạo đơn hàng: ' + error.message);
    } finally {
      setApiLoading(false);
    }
  };

  const loadOrders = async () => {
    try {
      const ordersData = await apiCall('/orders');
      setOrders(ordersData.orders || []);
    } catch (error) {
      console.error('Error loading orders:', error);
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    try {
      setApiLoading(true);
      await apiCall(`/orders/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      
      showNotification('Cập nhật trạng thái đơn hàng thành công!');
      await loadOrders();
    } catch (error) {
      showError('Lỗi khi cập nhật trạng thái: ' + error.message);
    } finally {
      setApiLoading(false);
    }
  };

  // Product tracing function
  const traceProduct = async () => {
    if (!searchCode) {
      showError('Vui lòng nhập mã sản phẩm');
      return;
    }

    try {
      setApiLoading(true);
      const result = await apiCall(`/public/trace?code=${encodeURIComponent(searchCode)}`);
      setTraceData(result);
      showNotification('Truy xuất thông tin sản phẩm thành công!');
    } catch (error) {
      showError('Lỗi khi truy xuất sản phẩm: ' + error.message);
      setTraceData(null);
    } finally {
      setApiLoading(false);
    }
  };

  const verifyProduct = async () => {
    if (!searchCode) {
      showError('Vui lòng nhập mã sản phẩm');
      return;
    }

    try {
      setApiLoading(true);
      const result = await apiCall(`/public/verify?code=${encodeURIComponent(searchCode)}`);
      
      if (result.verified) {
        showNotification('✅ Sản phẩm được xác thực trên blockchain!');
        setTraceData(result);
      } else {
        showError('❌ Sản phẩm không tìm thấy hoặc chưa được đăng ký');
        setTraceData(null);
      }
    } catch (error) {
      showError('Lỗi khi xác thực sản phẩm: ' + error.message);
      setTraceData(null);
    } finally {
      setApiLoading(false);
    }
  };

  // Navigation functions
  const getNavigationItems = () => {
    const baseItems = [
      { key: 'about', label: 'Giới thiệu', icon: Info },
      { key: 'contact', label: 'Liên hệ', icon: Phone }
    ];

    switch (user?.role) {
      case USER_ROLES.CONSUMER:
        return [
          { key: 'dashboard', label: 'Trang chủ', icon: Home },
          { key: 'trace', label: 'Kiểm tra sản phẩm', icon: Search },
          { key: 'verify', label: 'Xác thực Blockchain', icon: QrCode },
          ...baseItems
        ];
      case USER_ROLES.MANUFACTURER:
        return [
          { key: 'dashboard', label: 'Trang chủ', icon: Home },
          { key: 'products', label: 'Quản lý sản phẩm', icon: Package },
          { key: 'export', label: 'Xuất hàng', icon: TruckIcon },
          ...baseItems
        ];
      case USER_ROLES.RETAILER:
        return [
          { key: 'dashboard', label: 'Trang chủ', icon: Home },
          { key: 'products', label: 'Sản phẩm', icon: Package },
          { key: 'import', label: 'Nhập hàng', icon: Package },
          ...baseItems
        ];
      default:
        return baseItems;
    }
  };

  // Demo role selection
  const selectRoleDemo = async (role) => {
    const userData = {
      userId: `demo-${role}`,
      username: `Demo ${getRoleDisplayName(role)}`,
      email: `${role}@demo.com`,
      role: role,
      name: `Demo ${getRoleDisplayName(role)}`
    };
    
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setUser(userData);
    
    // Load mock data for demo
    await loadInitialData();
    setActiveTab('dashboard');
    showNotification(`Chế độ demo ${getRoleDisplayName(role)} đã được kích hoạt!`);
  };

  // Render functions
  const renderDashboard = () => {
    return (
      <div className="space-y-6">
        {/* Health Status */}
        {healthData && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <BarChart3 className="mr-2" size={20} />
              Trạng thái hệ thống
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <h4 className="font-semibold text-green-800">API</h4>
                <p className="text-green-600">{healthData.status}</p>
                <p className="text-sm text-green-500">Version: {healthData.version}</p>
              </div>
              <div className={`p-4 rounded-lg ${healthData.blockchain?.connected ? 'bg-green-50' : 'bg-yellow-50'}`}>
                <h4 className={`font-semibold ${healthData.blockchain?.connected ? 'text-green-800' : 'text-yellow-800'}`}>
                  Blockchain
                </h4>
                <p className={`${healthData.blockchain?.connected ? 'text-green-600' : 'text-yellow-600'}`}>
                  {healthData.blockchain?.connected ? 'Đã kết nối' : 'Chưa kết nối'}
                </p>
                <p className="text-sm text-gray-500">Network: {healthData.blockchain?.network}</p>
              </div>
              <div className={`p-4 rounded-lg ${healthData.database?.connected ? 'bg-green-50' : 'bg-red-50'}`}>
                <h4 className={`font-semibold ${healthData.database?.connected ? 'text-green-800' : 'text-red-800'}`}>
                  Database
                </h4>
                <p className={`${healthData.database?.connected ? 'text-green-600' : 'text-red-600'}`}>
                  {healthData.database?.connected ? 'Đã kết nối' : 'Lỗi kết nối'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Package className="text-blue-500 mr-3" size={24} />
              <div>
                <p className="text-sm text-gray-600">Sản phẩm</p>
                <p className="text-2xl font-bold">{products.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Building2 className="text-green-500 mr-3" size={24} />
              <div>
                <p className="text-sm text-gray-600">Nhà sản xuất</p>
                <p className="text-2xl font-bold">{manufacturers.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Store className="text-purple-500 mr-3" size={24} />
              <div>
                <p className="text-sm text-gray-600">Nhà bán lẻ</p>
                <p className="text-2xl font-bold">{retailers.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <ShoppingCart className="text-orange-500 mr-3" size={24} />
              <div>
                <p className="text-sm text-gray-600">Đơn hàng</p>
                <p className="text-2xl font-bold">{orders.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent products or company listings */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {user?.role === USER_ROLES.CONSUMER && (
            <>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-4 flex items-center">
                  <Building2 className="mr-2" size={20} />
                  Nhà sản xuất
                </h3>
                <div className="space-y-3">
                  {manufacturers.slice(0, 3).map(m => (
                    <div key={m.id} className="border rounded p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium">{m.name}</h4>
                          <p className="text-sm text-gray-600 flex items-center">
                            <MapPin size={14} className="mr-1" />
                            {m.location}
                          </p>
                          <p className="text-sm text-gray-600">{m.products} sản phẩm</p>
                        </div>
                        <div className="text-yellow-500">★ {m.rating}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-4 flex items-center">
                  <Store className="mr-2" size={20} />
                  Nhà bán lẻ
                </h3>
                <div className="space-y-3">
                  {retailers.slice(0, 3).map(r => (
                    <div key={r.id} className="border rounded p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium">{r.name}</h4>
                          <p className="text-sm text-gray-600 flex items-center">
                            <MapPin size={14} className="mr-1" />
                            {r.location}
                          </p>
                          <p className="text-sm text-gray-600">{r.manufacturers} nhà cung cấp</p>
                        </div>
                        <div className="text-yellow-500">★ {r.rating}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {(user?.role === USER_ROLES.MANUFACTURER || user?.role === USER_ROLES.RETAILER) && (
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Sản phẩm gần đây</h3>
                <button
                  onClick={() => setActiveTab('products')}
                  className="text-blue-500 hover:text-blue-700"
                >
                  Xem tất cả
                </button>
              </div>
              <div className="space-y-3">
                {products.slice(0, 5).map(product => (
                  <div key={product.id} className="border rounded p-3">
                    <div className="flex justify-between">
                      <div>
                        <h4 className="font-medium">{product.name}</h4>
                        <p className="text-sm text-gray-600">{product.category}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{product.quantity} còn lại</p>
                        <p className="text-sm text-gray-600">{product.price?.toLocaleString()} VND</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTrace = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Truy xuất thông tin sản phẩm</h2>
        <div className="flex gap-4">
          <input
            type="text"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-md"
            placeholder="Nhập mã sản phẩm"
          />
          <button
            onClick={traceProduct}
            disabled={apiLoading}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {apiLoading ? 'Đang xử lý...' : 'Truy xuất'}
          </button>
        </div>
      </div>

      {traceData && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Thông tin sản phẩm</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Mã sản phẩm</p>
                <p className="font-medium">{traceData.productId}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Tên sản phẩm</p>
                <p className="font-medium">{traceData.productName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Nhà sản xuất</p>
                <p className="font-medium">{traceData.manufacturer}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Mã lô</p>
                <p className="font-medium">{traceData.batch}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Trạng thái hiện tại</p>
                <p className="font-medium">{traceData.currentStatus}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Xác thực Blockchain</p>
                <p className="font-medium">
                  {traceData.blockchainVerified ? (
                    <span className="inline-flex items-center text-green-600">
                      <Check className="w-4 h-4 mr-1" />
                      Đã xác thực
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-red-600">
                      <AlertCircle className="w-4 h-4 mr-1" />
                      Chưa xác thực
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4">Lịch sử truy xuất</h3>
              <div className="space-y-4">
                {traceData.trace.map((record, index) => (
                  <div key={index} className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <span className="text-blue-600 font-medium">{index + 1}</span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{record.stage}</h4>
                        <span className="text-sm text-gray-500">{record.date}</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{record.company}</p>
                      <p className="text-sm text-gray-600">{record.location}</p>
                      <p className="text-sm text-gray-600 mt-2">{record.details}</p>
                      {record.blockchainTxHash && record.blockchainTxHash !== 'N/A' && (
                        <div className="mt-2">
                          <a
                            href={`https://sepolia.etherscan.io/tx/${record.blockchainTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="w-4 h-4 mr-1" />
                            Xem giao dịch trên Etherscan
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderVerify = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Xác thực sản phẩm trên Blockchain</h2>
        <div className="flex gap-4">
          <input
            type="text"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-md"
            placeholder="Nhập mã sản phẩm"
          />
          <button
            onClick={verifyProduct}
            disabled={apiLoading}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {apiLoading ? 'Đang xử lý...' : 'Xác thực'}
          </button>
        </div>
      </div>

      {traceData && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Kết quả xác thực</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Trạng thái xác thực</p>
                <p className="font-medium">
                  {traceData.verified ? (
                    <span className="inline-flex items-center text-green-600">
                      <Check className="w-4 h-4 mr-1" />
                      Đã xác thực
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-red-600">
                      <AlertCircle className="w-4 h-4 mr-1" />
                      Chưa xác thực
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Thời gian xác thực</p>
                <p className="font-medium">{new Date(traceData.verificationTime).toLocaleString()}</p>
              </div>
            </div>

            {traceData.verified && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Mã sản phẩm</p>
                    <p className="font-medium">{traceData.productId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Tên sản phẩm</p>
                    <p className="font-medium">{traceData.blockchainData.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Nhà sản xuất</p>
                    <p className="font-medium">{traceData.blockchainData.manufacturer}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Mã lô</p>
                    <p className="font-medium">{traceData.blockchainData.batch}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Trạng thái</p>
                    <p className="font-medium">{traceData.blockchainData.status}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Thời gian đăng ký</p>
                    <p className="font-medium">
                      {new Date(traceData.blockchainData.timestamp * 1000).toLocaleString()}
                    </p>
                  </div>
                </div>

                {traceData.databaseData && (
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold mb-4">Thông tin bổ sung từ cơ sở dữ liệu</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-500">Danh mục</p>
                        <p className="font-medium">{traceData.databaseData.category}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Mô tả</p>
                        <p className="font-medium">{traceData.databaseData.description}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Giá</p>
                        <p className="font-medium">{traceData.databaseData.price}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">Số lượng</p>
                        <p className="font-medium">{traceData.databaseData.quantity}</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderProducts = () => (
    <div className="space-y-6">
      {/* Ẩn form thêm sản phẩm nếu là nhà bán lẻ */}
      {user?.role !== USER_ROLES.RETAILER && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Thêm sản phẩm mới</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên sản phẩm</label>
              <input
                type="text"
                value={productForm.name}
                onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Nhập tên sản phẩm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Danh mục</label>
              <input
                type="text"
                value={productForm.category}
                onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Nhập danh mục"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
              <input
                type="text"
                value={productForm.description}
                onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Nhập mô tả"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Số lượng</label>
              <input
                type="number"
                value={productForm.quantity}
                onChange={(e) => setProductForm({ ...productForm, quantity: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Nhập số lượng"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Giá</label>
              <input
                type="number"
                value={productForm.price}
                onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Nhập giá"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mã lô</label>
              <input
                type="text"
                value={productForm.batch}
                onChange={(e) => setProductForm({ ...productForm, batch: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Nhập mã lô"
              />
            </div>
          </div>
          <button
            onClick={addProduct}
            disabled={apiLoading}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {apiLoading ? 'Đang xử lý...' : 'Thêm sản phẩm'}
          </button>
        </div>
      )}
      {/* Danh sách sản phẩm vẫn hiển thị cho mọi vai trò */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">Danh sách sản phẩm</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mã sản phẩm</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tên</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Danh mục</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Số lượng</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Giá</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mã lô</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Blockchain</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Thao tác</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {products.map((product) => (
                  <tr key={product.id}>
                    <td className="px-6 py-4 whitespace-nowrap">{product.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.category}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.quantity}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.price}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{product.batch}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {product.blockchainStatus === 'registered' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <Check className="w-4 h-4 mr-1" />
                          Đã đăng ký
                        </span>
                      ) : product.blockchainStatus === 'pending' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                          Đang xử lý
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          <AlertCircle className="w-4 h-4 mr-1" />
                          Lỗi
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => setEditingItem(product)}
                        className="text-blue-600 hover:text-blue-900 mr-4"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteProduct(product.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOrders = (type) => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">
          {type === 'export' ? 'Tạo đơn xuất hàng' : type === 'import' ? 'Tạo đơn nhập hàng' : 'Tạo đơn bán hàng'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sản phẩm</label>
            <select
              value={orderForm.productId}
              onChange={(e) => setOrderForm({ ...orderForm, productId: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">Chọn sản phẩm</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} - {product.batch}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Số lượng</label>
            <input
              type="number"
              value={orderForm.quantity}
              onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="Nhập số lượng"
            />
          </div>
          {type === 'export' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mã người nhận</label>
                <input
                  type="text"
                  value={orderForm.recipientId}
                  onChange={(e) => setOrderForm({ ...orderForm, recipientId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Nhập mã người nhận"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên người nhận</label>
                <input
                  type="text"
                  value={orderForm.recipientName}
                  onChange={(e) => setOrderForm({ ...orderForm, recipientName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Nhập tên người nhận"
                />
              </div>
            </>
          )}
          {type === 'import' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mã nhà cung cấp</label>
                <input
                  type="text"
                  value={orderForm.recipientId}
                  onChange={(e) => setOrderForm({ ...orderForm, recipientId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Nhập mã nhà cung cấp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên nhà cung cấp</label>
                <input
                  type="text"
                  value={orderForm.supplierName}
                  onChange={(e) => setOrderForm({ ...orderForm, supplierName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Nhập tên nhà cung cấp"
                />
              </div>
            </>
          )}
          {type === 'sale' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Thông tin khách hàng</label>
              <input
                type="text"
                value={orderForm.customerInfo}
                onChange={(e) => setOrderForm({ ...orderForm, customerInfo: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Nhập thông tin khách hàng"
              />
            </div>
          )}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
            <textarea
              value={orderForm.notes}
              onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="Nhập ghi chú"
              rows="3"
            />
          </div>
        </div>
        <button
          onClick={() => addOrder(type)}
          disabled={apiLoading}
          className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {apiLoading ? 'Đang xử lý...' : `Tạo đơn ${type === 'export' ? 'xuất' : type === 'import' ? 'nhập' : 'bán'}`}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-4">
            {type === 'export' ? 'Danh sách đơn xuất hàng' : type === 'import' ? 'Danh sách đơn nhập hàng' : 'Danh sách đơn bán hàng'}
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mã đơn</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sản phẩm</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Số lượng</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trạng thái</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ngày tạo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Thao tác</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orders
                  .filter((order) => order.type === type)
                  .map((order) => (
                    <tr key={order.id}>
                      <td className="px-6 py-4 whitespace-nowrap">{order.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{order.productName}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{order.quantity}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            order.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : order.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {order.status === 'completed'
                            ? 'Hoàn thành'
                            : order.status === 'pending'
                            ? 'Đang xử lý'
                            : 'Đã hủy'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {order.status === 'pending' && (
                          <button
                            onClick={() => updateOrderStatus(order.id, 'completed')}
                            className="text-green-600 hover:text-green-900"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAbout = () => (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-2xl font-bold mb-6 text-center text-blue-600">
        Giới thiệu về Hệ thống Truy xuất Nguồn gốc Sản phẩm
      </h3>
      
      <div className="space-y-6">
        <section>
          <h4 className="text-xl font-semibold mb-3 text-gray-800">Tổng quan</h4>
          <p className="text-gray-600 leading-relaxed">
            Hệ thống Truy xuất Nguồn gốc Sản phẩm sử dụng công nghệ Blockchain Ethereum và các API hiện đại
            để đảm bảo tính minh bạch và truy xuất nguồn gốc của các sản phẩm từ khâu sản xuất đến tay người tiêu dùng.
          </p>
        </section>

        <section>
          <h4 className="text-xl font-semibold mb-3 text-gray-800">Công nghệ sử dụng</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h5 className="font-semibold text-blue-800 mb-2">Backend</h5>
              <ul className="text-sm text-blue-600 space-y-1">
                <li>• AWS Lambda (Node.js)</li>
                <li>• API Gateway</li>
                <li>• DynamoDB</li>
                <li>• Cognito Authentication</li>
              </ul>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h5 className="font-semibold text-green-800 mb-2">Blockchain</h5>
              <ul className="text-sm text-green-600 space-y-1">
                <li>• Ethereum Sepolia Testnet</li>
                <li>• Smart Contracts</li>
                <li>• Web3.js Integration</li>
                <li>• Immutable Product Registry</li>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h4 className="text-xl font-semibold mb-3 text-gray-800">Tính năng chính</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h5 className="font-semibold text-blue-800 mb-2">Cho người tiêu dùng</h5>
              <ul className="text-sm text-blue-600 space-y-1">
                <li>• Tra cứu nguồn gốc sản phẩm</li>
                <li>• Xác thực trên Blockchain</li>
                <li>• Xem lịch trình vận chuyển</li>
                <li>• Thông tin nhà sản xuất</li>
              </ul>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h5 className="font-semibold text-green-800 mb-2">Cho nhà sản xuất</h5>
              <ul className="text-sm text-green-600 space-y-1">
                <li>• Đăng ký sản phẩm trên Blockchain</li>
                <li>• Quản lý danh mục sản phẩm</li>
                <li>• Theo dõi đơn hàng xuất</li>
                <li>• Cập nhật trạng thái sản xuất</li>
              </ul>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <h5 className="font-semibold text-purple-800 mb-2">Cho nhà bán lẻ</h5>
              <ul className="text-sm text-purple-600 space-y-1">
                <li>• Quản lý kho hàng</li>
                <li>• Theo dõi nhập/xuất</li>
                <li>• Xử lý đơn bán hàng</li>
                <li>• Báo cáo kinh doanh</li>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h4 className="text-xl font-semibold mb-3 text-gray-800">API Endpoints</h4>
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <h6 className="font-semibold mb-2">User Management</h6>
                <ul className="space-y-1 text-gray-600">
                  <li>GET /users/me</li>
                  <li>POST /users/update-role</li>
                </ul>
              </div>
              <div>
                <h6 className="font-semibold mb-2">Product Management</h6>
                <ul className="space-y-1 text-gray-600">
                  <li>GET /products</li>
                  <li>POST /products</li>
                  <li>PUT /products/[product-id]</li>
                  <li>DELETE /products/[product-id]</li>
                </ul>
              </div>
              <div>
                <h6 className="font-semibold mb-2">Verification</h6>
                <ul className="space-y-1 text-gray-600">
                  <li>GET /verify</li>
                  <li>GET /trace</li>
                  <li>GET /public/verify</li>
                </ul>
              </div>
              <div>
                <h6 className="font-semibold mb-2">Order Management</h6>
                <ul className="space-y-1 text-gray-600">
                  <li>GET /orders</li>
                  <li>POST /orders</li>
                  <li>PUT /orders/[order-id]</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  const renderContact = () => (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-2xl font-bold mb-6 text-center text-blue-600">
        Thông tin Liên hệ
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h4 className="text-xl font-semibold mb-4 text-gray-800">Thông tin dự án</h4>
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <Building2 className="text-blue-500 mt-1" size={20} />
              <div>
                <h5 className="font-semibold">Product Traceability System</h5>
                <p className="text-gray-600">Hệ thống truy xuất nguồn gốc sản phẩm sử dụng Blockchain</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <MapPin className="text-blue-500 mt-1" size={20} />
              <div>
                <h5 className="font-semibold">Công nghệ</h5>
                <p className="text-gray-600">
                  Frontend: React + Tailwind CSS<br/>
                  Backend: AWS Lambda + Node.js<br/>
                  Database: DynamoDB<br/>
                  Blockchain: Ethereum Sepolia
                </p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <ExternalLink className="text-blue-500 mt-1" size={20} />
              <div>
                <h5 className="font-semibold">API Endpoint</h5>
                <p className="text-gray-600 break-all">
                  {API_URL}
                </p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <User className="text-blue-500 mt-1" size={20} />
              <div>
                <h5 className="font-semibold">Authentication</h5>
                <p className="text-gray-600">
                  AWS Cognito<br/>
                  Domain: {COGNITO_DOMAIN}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-xl font-semibold mb-4 text-gray-800">Hướng dẫn sử dụng</h4>
          <div className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h5 className="font-semibold text-blue-800 mb-2">1. Đăng nhập</h5>
              <p className="text-sm text-blue-600">
                Sử dụng AWS Cognito để đăng nhập hoặc chọn chế độ demo để test
              </p>
            </div>
            
            <div className="bg-green-50 p-4 rounded-lg">
              <h5 className="font-semibold text-green-800 mb-2">2. Chọn vai trò</h5>
              <p className="text-sm text-green-600">
                Người tiêu dùng, Nhà sản xuất, hoặc Nhà bán lẻ - mỗi vai trò có quyền truy cập khác nhau
              </p>
            </div>
            
            <div className="bg-purple-50 p-4 rounded-lg">
              <h5 className="font-semibold text-purple-800 mb-2">3. Sử dụng tính năng</h5>
              <p className="text-sm text-purple-600">
                Quản lý sản phẩm, tra cứu nguồn gốc, xác thực blockchain theo vai trò
              </p>
            </div>
            
            <div className="bg-orange-50 p-4 rounded-lg">
              <h5 className="font-semibold text-orange-800 mb-2">4. Blockchain</h5>
              <p className="text-sm text-orange-600">
                Tất cả sản phẩm được đăng ký trên Ethereum Sepolia testnet để đảm bảo tính minh bạch
              </p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="mt-8 pt-8 border-t">
        <h4 className="text-lg font-semibold mb-4 text-gray-800">Trạng thái hệ thống</h4>
        {healthData ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
            <div className="bg-green-50 p-4 rounded-lg">
              <h5 className="font-semibold text-green-800">API Status</h5>
              <p className="text-green-600">{healthData.status}</p>
              <p className="text-xs text-green-500">v{healthData.version}</p>
            </div>
            <div className={`p-4 rounded-lg ${healthData.blockchain?.connected ? 'bg-green-50' : 'bg-yellow-50'}`}>
              <h5 className={`font-semibold ${healthData.blockchain?.connected ? 'text-green-800' : 'text-yellow-800'}`}>
                Blockchain
              </h5>
              <p className={`${healthData.blockchain?.connected ? 'text-green-600' : 'text-yellow-600'}`}>
                {healthData.blockchain?.connected ? 'Connected' : 'Disconnected'}
              </p>
              <p className="text-xs text-gray-500">{healthData.blockchain?.network}</p>
            </div>
            <div className={`p-4 rounded-lg ${healthData.database?.connected ? 'bg-green-50' : 'bg-red-50'}`}>
              <h5 className={`font-semibold ${healthData.database?.connected ? 'text-green-800' : 'text-red-800'}`}>
                Database
              </h5>
              <p className={`${healthData.database?.connected ? 'text-green-600' : 'text-red-600'}`}>
                {healthData.database?.connected ? 'Connected' : 'Error'}
              </p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <h5 className="font-semibold text-blue-800">Environment</h5>
              <p className="text-blue-600">Development</p>
              <p className="text-xs text-blue-500">ap-southeast-1</p>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-500">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
            <p>Đang kiểm tra trạng thái hệ thống...</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': 
        return renderDashboard();
      case 'trace': 
        return (
          <RoleGuard allowedRoles={[USER_ROLES.CONSUMER]}>
            {renderTrace()}
          </RoleGuard>
        );
      case 'verify':
        return (
          <RoleGuard allowedRoles={[USER_ROLES.CONSUMER]}>
            {renderVerify()}
          </RoleGuard>
        );
      case 'products': 
      case 'add-product': 
        return renderProducts();
      case 'export': 
      case 'add-export': 
        return (
          <RoleGuard allowedRoles={[USER_ROLES.MANUFACTURER]}>
            {renderOrders('export')}
          </RoleGuard>
        );
      case 'import': 
      case 'add-import': 
        return (
          <RoleGuard allowedRoles={[USER_ROLES.RETAILER]}>
            {renderOrders('import')}
          </RoleGuard>
        );
      case 'about': 
        return renderAbout();
      case 'contact': 
        return renderContact();
      default: 
        return renderDashboard();
    }
  };

  // Show role selection if no user
  if (!user && !loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-4">
              Hệ thống Truy xuất Nguồn gốc Sản phẩm
            </h1>
            <p className="text-xl text-gray-600 mb-2">
              Sử dụng công nghệ Blockchain và AWS Cloud
            </p>
            <p className="text-lg text-gray-500">
              Chọn vai trò của bạn để tiếp tục
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div 
              onClick={login}
              className="bg-white p-8 rounded-xl shadow-lg hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500 group"
            >
              <div className="text-center">
                <div className="bg-blue-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-200 transition-colors">
                  <Users className="text-blue-600" size={32} />
                </div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2">Người tiêu dùng</h3>
                <p className="text-gray-600 mb-4">
                  Tra cứu nguồn gốc sản phẩm và xác thực trên blockchain
                </p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>• Tra cứu thông tin sản phẩm</li>
                  <li>• Xác thực blockchain</li>
                  <li>• Xem lịch trình vận chuyển</li>
                </ul>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="bg-blue-50 text-blue-700 text-xs px-3 py-1 rounded-full inline-block">
                    Đăng nhập với Cognito
                  </div>
                </div>
              </div>
            </div>

            <div 
              onClick={login}
              className="bg-white p-8 rounded-xl shadow-lg hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-green-500 group"
            >
              <div className="text-center">
                <div className="bg-green-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4 group-hover:bg-green-200 transition-colors">
                  <Building2 className="text-green-600" size={32} />
                </div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2">Nhà sản xuất</h3>
                <p className="text-gray-600 mb-4">
                  Đăng ký sản phẩm lên blockchain và quản lý xuất hàng
                </p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>• Đăng ký sản phẩm blockchain</li>
                  <li>• Quản lý danh mục sản phẩm</li>
                  <li>• Theo dõi đơn xuất hàng</li>
                </ul>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="bg-green-50 text-green-700 text-xs px-3 py-1 rounded-full inline-block">
                    Đăng nhập với Cognito
                  </div>
                </div>
              </div>
            </div>

            <div 
              onClick={login}
              className="bg-white p-8 rounded-xl shadow-lg hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-purple-500 group"
            >
              <div className="text-center">
                <div className="bg-purple-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4 group-hover:bg-purple-200 transition-colors">
                  <Store className="text-purple-600" size={32} />
                </div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2">Nhà bán lẻ</h3>
                <p className="text-gray-600 mb-4">
                  Quản lý kho hàng, nhập hàng
                </p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>• Quản lý tồn kho</li>
                  <li>• Theo dõi nhập/xuất hàng</li>
                </ul>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="bg-purple-50 text-purple-700 text-xs px-3 py-1 rounded-full inline-block">
                    Đăng nhập với Cognito
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto border-4 border-t-4 border-gray-200 rounded-full border-t-blue-500 animate-spin"></div>
          <p className="mt-4 text-gray-600">Đang tải...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:block`}>
        <div className="p-4 border-b bg-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold">Truy xuất Nguồn gốc</h1>
              <p className="text-sm opacity-90">
                {getRoleDisplayName(user?.role)}
              </p>
            </div>
            <button className="md:hidden text-white" onClick={() => setSidebarOpen(false)}>
              <X size={24} />
            </button>
          </div>
        </div>
        
        {user && (
          <>
            <div className="p-4 border-b">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-100 p-2 rounded-full">
                  <User className="text-blue-600" size={20} />
                </div>
                <div>
                  <p className="font-medium">{user.name || user.username}</p>
                  <p className="text-xs text-gray-500">{user.email}</p>
                </div>
              </div>
            </div>
            
            <nav className="p-4">
              <ul className="space-y-2">
                {getNavigationItems().map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.key}>
                      <button
                        className={`flex items-center w-full px-4 py-2 rounded-md transition-colors ${
                          activeTab === item.key 
                            ? 'bg-blue-100 text-blue-700' 
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                        onClick={() => {
                          setActiveTab(item.key);
                          setSidebarOpen(false);
                        }}
                      >
                        <Icon size={18} className="mr-3" />
                        {item.label}
                      </button>
                    </li>
                  );
                })}
                <li className="pt-4 mt-4 border-t">
                  <button
                    className="flex items-center w-full px-4 py-2 text-red-600 rounded-md hover:bg-red-50 transition-colors"
                    onClick={logout}
                  >
                    <LogOut size={18} className="mr-3" />
                    Đăng xuất
                  </button>
                </li>
              </ul>
            </nav>
          </>
        )}
      </div>
      
      {/* Main content */}
      <div className="flex-1">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center justify-between p-4 bg-white shadow-sm border-b">
          <div className="flex items-center">
            <button 
              className="md:hidden mr-4" 
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={24} />
            </button>
            <h2 className="text-xl font-semibold text-gray-800">
              {activeTab === 'dashboard' ? 'Trang chủ' :
               activeTab === 'trace' ? 'Tra cứu sản phẩm' :
               activeTab === 'verify' ? 'Xác thực Blockchain' :
               activeTab === 'products' || activeTab === 'add-product' ? 'Quản lý sản phẩm' :
               activeTab === 'export' || activeTab === 'add-export' ? 'Xuất hàng' :
               activeTab === 'import' || activeTab === 'add-import' ? 'Nhập hàng' :
               activeTab === 'sale' || activeTab === 'add-sale' ? 'Bán hàng' :
               activeTab === 'about' ? 'Giới thiệu' :
               activeTab === 'contact' ? 'Liên hệ' : 'Hệ thống'}
            </h2>
          </div>
          
          <div className="flex items-center space-x-4">
            {healthData && (
              <div className={`flex items-center space-x-2 text-sm px-3 py-1 rounded-full ${
                healthData.blockchain?.connected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  healthData.blockchain?.connected ? 'bg-green-500' : 'bg-yellow-500'
                }`}></div>
                <span>Blockchain</span>
              </div>
            )}
            <div className="hidden md:flex items-center space-x-2 text-sm text-gray-600">
              <Calendar size={16} />
              <span>{new Date().toLocaleDateString('vi-VN')}</span>
            </div>
          </div>
        </header>
        
        {/* Notifications */}
        {notification && (
          <div className="fixed top-4 right-4 z-50 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center">
            <Check size={20} className="mr-2" />
            {notification}
          </div>
        )}
        
        {error && (
          <div className="fixed top-4 right-4 z-50 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center">
            <AlertCircle size={20} className="mr-2" />
            {error}
            <button 
              className="ml-4 text-white hover:text-gray-200"
              onClick={() => setError('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        
        {/* Global Loading Indicator. */}
        {apiLoading && (
          <div className="fixed top-20 right-4 z-50 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center">
            <RefreshCw size={16} className="mr-2 animate-spin" />
            Đang xử lý...
          </div>
        )}
        
        {/* Content */}
        <main className="p-6">
          {renderContent()}
        </main>
      </div>
      
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}