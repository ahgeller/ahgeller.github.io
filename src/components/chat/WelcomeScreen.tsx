import { BarChart3, TrendingUp, Database, Sparkles, Zap, LineChart, FileUp, MessageSquare, ArrowRight } from "lucide-react";

const WelcomeScreen = () => {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-6 md:p-10">
      <div className="max-w-6xl w-full space-y-8 animation-fade-in">
        {/* Hero Section */}
        <div className="text-center mb-4">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Get Started
          </h1>
        </div>

        {/* Getting Started Steps */}
        <div className="grid md:grid-cols-3 gap-4 md:gap-6 mb-8">
          <div className="bg-gradient-to-br from-card to-card/30 rounded-2xl p-6 border border-border/40 hover:border-primary/40 transition-all group">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-primary/10 rounded-xl group-hover:scale-110 transition-transform">
                <FileUp className="h-6 w-6 text-primary" />
              </div>
              <div className="text-2xl font-bold text-primary">1</div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Upload Data</h3>
            <p className="text-sm text-muted-foreground">
              Upload CSV, Excel, or connect to a database
            </p>
          </div>

          <div className="bg-gradient-to-br from-card to-card/30 rounded-2xl p-6 border border-border/40 hover:border-primary/40 transition-all group">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-primary/10 rounded-xl group-hover:scale-110 transition-transform">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <div className="text-2xl font-bold text-primary">2</div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Ask Questions</h3>
            <p className="text-sm text-muted-foreground">
              Chat naturally about your data and get instant insights
            </p>
          </div>

          <div className="bg-gradient-to-br from-card to-card/30 rounded-2xl p-6 border border-border/40 hover:border-primary/40 transition-all group">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-primary/10 rounded-xl group-hover:scale-110 transition-transform">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div className="text-2xl font-bold text-primary">3</div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Get Insights</h3>
            <p className="text-sm text-muted-foreground">
              Receive AI-powered analysis, charts, and recommendations
            </p>
          </div>
        </div>

        {/* Capabilities */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground/60 mb-3">Platform Capabilities</p>
          <div className="flex flex-wrap justify-center gap-2">
            <div className="px-3 py-1.5 bg-card/30 rounded-full border border-border/30 flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-xs text-muted-foreground">Pattern Recognition</span>
            </div>
            <div className="px-3 py-1.5 bg-card/30 rounded-full border border-border/30 flex items-center gap-2">
              <LineChart className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-xs text-muted-foreground">Visualizations</span>
            </div>
            <div className="px-3 py-1.5 bg-card/30 rounded-full border border-border/30 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-xs text-muted-foreground">Live Analysis</span>
            </div>
            <div className="px-3 py-1.5 bg-card/30 rounded-full border border-border/30 flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-xs text-muted-foreground">Data Exploration</span>
            </div>
            <div className="px-3 py-1.5 bg-card/30 rounded-full border border-border/30 flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-xs text-muted-foreground">Statistics</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;

