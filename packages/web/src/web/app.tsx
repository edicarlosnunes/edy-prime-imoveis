import { Route, Switch } from "wouter";
import Index from "./pages/index";
import AdminLogin from "./pages/admin/login";
import AdminDashboard from "./pages/admin/dashboard";
import AdminProperties from "./pages/admin/properties";
import AdminLeads from "./pages/admin/leads";
import AdminClients from "./pages/admin/clients";
import AdminOwners from "./pages/admin/owners";
import AdminAgenda from "./pages/admin/agenda";
import AdminDeals from "./pages/admin/deals";
import AdminSettings from "./pages/admin/settings";
import AdminSiteEditor from "./pages/admin/site-editor";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";

function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/" component={Index} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin/imoveis" component={AdminProperties} />
        <Route path="/admin/leads" component={AdminLeads} />
        <Route path="/admin/clientes" component={AdminClients} />
        <Route path="/admin/proprietarios" component={AdminOwners} />
        <Route path="/admin/agenda" component={AdminAgenda} />
        <Route path="/admin/propostas" component={AdminDeals} />
        <Route path="/admin/configuracoes" component={AdminSettings} />
        <Route path="/admin/editor" component={AdminSiteEditor} />
      </Switch>
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
      {/* "Made with Runable" badge - if user asks to remove the runable badge, remove this code as well as comment */}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
