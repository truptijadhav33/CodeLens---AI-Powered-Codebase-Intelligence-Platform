import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import Home from './pages/Home'
import SelectRepository from './pages/SelectRepository'
import RepoDetail from './pages/RepoDetail'
import MyRepositories from './pages/MyRepositories'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route element={<RequireAuth />}>
          <Route path="/repos" element={<SelectRepository />} />
          <Route path="/repos/:id" element={<RepoDetail />} />
          <Route path="/my" element={<MyRepositories />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}

export default App