import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { FeatureFlagsProvider } from './hooks/useFeatureFlags';
import { ProtectedRoute } from './components/ProtectedRoute';
import Signup from './pages/Signup';
import Login from './pages/Login';
import DashboardLayout from './layouts/DashboardLayout';
import Feed from './pages/Feed';
import Chat from './pages/Chat';
import Profile from './pages/Profile';
import CreatePost from './pages/CreatePost';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Bookmarks from './pages/Bookmarks';
import Notifications from './pages/Notifications';
import Analytics from './pages/Analytics';
import Admin from './pages/Admin';
import ActivityFeed from './pages/ActivityFeed';
import Leaderboard from './pages/Leaderboard';
import ManageOrganization from './pages/ManageOrganization';
import CollaborationPortal from './pages/CollaborationPortal';
import { TenantProvider } from './context/TenantContext';

/**
 * Main App Component:
 * Integrates our AuthProvider and sets up private routes.
 * 
 * Layout Nesting:
 * The DashboardLayout component renders the Sidebar and Top Navbar.
 * The nested routes (feed, chat, profile) render *inside* DashboardLayout's <Outlet />.
 */
function App() {
  return (
    <AuthProvider>
      <TenantProvider>
        <FeatureFlagsProvider>
          <Router>
            <Routes>
              {/* Public Routes (No login required) */}
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Protected Routes (Requires active session) */}
              <Route
                element={
                  <ProtectedRoute>
                    <DashboardLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/feed" element={<Feed />} />
                <Route path="/create-post" element={<CreatePost />} />
                <Route path="/chat" element={<Chat />} />
                <Route path="/activity" element={<ActivityFeed />} />
                <Route path="/bookmarks" element={<Bookmarks />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/organization" element={<ManageOrganization />} />
                <Route path="/collaboration" element={<CollaborationPortal />} />
                <Route path="/admin" element={
                  <ProtectedRoute allowedRoles={['moderator', 'admin']}>
                    <Admin />
                  </ProtectedRoute>
                } />
                <Route path="/profile" element={<Profile />} />
                <Route path="/profile/:userId" element={<Profile />} />
              </Route>

              {/* Default/Fallback Redirect: If authenticated, ProtectedRoute allows /feed, otherwise redirects to /login */}
              <Route path="*" element={<Navigate to="/feed" replace />} />
            </Routes>
          </Router>
        </FeatureFlagsProvider>
      </TenantProvider>
    </AuthProvider>
  );
}


export default App;



