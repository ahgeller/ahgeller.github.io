import { BarChart3, TrendingUp, Database, Sparkles } from "lucide-react";

const WelcomeScreen = () => {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-3xl text-center space-y-8 animation-fade-in">
        <div>
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Data Analytics AI
          </h1>
          <p className="text-lg text-muted-foreground">
            Your intelligent assistant for data analysis and insights
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-12">
          <div className="bg-chat-assistant rounded-lg p-6 hover:bg-chat-hover transition-colors">
            <BarChart3 className="h-8 w-8 text-primary mb-3 mx-auto" />
            <h3 className="font-semibold mb-2">Data Analysis</h3>
            <p className="text-sm text-muted-foreground">
              Explore your data with comprehensive statistics and visualizations
            </p>
          </div>

          <div className="bg-chat-assistant rounded-lg p-6 hover:bg-chat-hover transition-colors">
            <TrendingUp className="h-8 w-8 text-primary mb-3 mx-auto" />
            <h3 className="font-semibold mb-2">Pattern Recognition</h3>
            <p className="text-sm text-muted-foreground">
              Identify trends, correlations, and patterns across your datasets
            </p>
          </div>

          <div className="bg-chat-assistant rounded-lg p-6 hover:bg-chat-hover transition-colors">
            <Database className="h-8 w-8 text-primary mb-3 mx-auto" />
            <h3 className="font-semibold mb-2">Data Exploration</h3>
            <p className="text-sm text-muted-foreground">
              Query and analyze data from databases, CSV files, or custom sources
            </p>
          </div>

          <div className="bg-chat-assistant rounded-lg p-6 hover:bg-chat-hover transition-colors">
            <Sparkles className="h-8 w-8 text-primary mb-3 mx-auto" />
            <h3 className="font-semibold mb-2">AI-Powered Insights</h3>
            <p className="text-sm text-muted-foreground">
              Get intelligent recommendations and actionable insights from your data
            </p>
          </div>
        </div>

        <div className="pt-6">
          <p className="text-sm text-muted-foreground">
            Start by selecting your data source above, or type a question to begin analyzing
          </p>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;

