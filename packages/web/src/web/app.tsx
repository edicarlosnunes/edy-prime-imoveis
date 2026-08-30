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
import AdminIntegrations from "./pages/admin/integrations";
import AdminPortals from "./pages/admin/portals";
import AdminConversations from "./pages/admin/conversations";
import AdminAi from "./pages/admin/ai";
import AdminAutomations from "./pages/admin/automations";
import AdminWatermark from "./pages/admin/watermark";
import AdminAudit from "./pages/admin/audit";
import PropertyPage from "./pages/imovel";
import Privacidade from "./pages/privacidade";
import Termos from "./pages/termos";
import { Provider } from "./components/provider";
import { AgentFeedback } from "@runablehq/website-runtime";

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
        <Route path="/admin/integracoes" component={AdminIntegrations} />
        <Route path="/admin/portais" component={AdminPortals} />
        <Route path="/admin/conversas" component={AdminConversations} />
        <Route path="/admin/ia" component={AdminAi} />
        <Route path="/admin/automacoes" component={AdminAutomations} />
        <Route path="/admin/marca-dagua" component={AdminWatermark} />
        <Route path="/admin/auditoria" component={AdminAudit} />
        <Route path="/privacidade" component={Privacidade} />
        <Route path="/termos" component={Termos} />
        <Route path="/imovel/:slug" component={PropertyPage} />
      </Switch>
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

export default App;
