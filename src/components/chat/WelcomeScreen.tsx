import { BarChart3, TrendingUp, Database, Sparkles } from "lucide-react";

const WelcomeScreen = () => {
  return (
    <div className="flex items-center justify-center md:min-h-full md:p-8 p-3 py-4">
      <div className="max-w-3xl text-center md:space-y-8 space-y-2 animation-fade-in">
        <div>
          <h1 className="md:text-4xl text-xl font-bold md:mb-3 mb-1 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Data Analytics AI
          </h1>
          <p className="md:text-lg text-xs text-muted-foreground md:block hidden">
            Your intelligent assistant for data analysis and insights
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-2 gap-2 md:gap-4 md:mt-12 mt-2">
          <div className="bg-chat-assistant rounded-lg md:p-6 p-2 hover:bg-chat-hover transition-colors">
            <BarChart3 className="md:h-8 md:w-8 h-5 w-5 text-primary md:mb-3 mb-1 mx-auto" />
            <h3 className="font-semibold md:mb-2 mb-0 md:text-base text-xs">Data Analysis</h3>
            <p className="text-xs md:text-sm text-muted-foreground md:block hidden">
              Explore your data with comprehensive statistics and visualizations
            </p>
          </div>

          <div className="bg-chat-assistant rounded-lg md:p-6 p-2 hover:bg-chat-hover transition-colors">
            <TrendingUp className="md:h-8 md:w-8 h-5 w-5 text-primary md:mb-3 mb-1 mx-auto" />
            <h3 className="font-semibold md:mb-2 mb-0 md:text-base text-xs">Pattern Recognition</h3>
            <p className="text-xs md:text-sm text-muted-foreground md:block hidden">
              Identify trends, correlations, and patterns across your datasets
            </p>
          </div>

          <div className="bg-chat-assistant rounded-lg md:p-6 p-2 hover:bg-chat-hover transition-colors">
            <Database className="md:h-8 md:w-8 h-5 w-5 text-primary md:mb-3 mb-1 mx-auto" />
            <h3 className="font-semibold md:mb-2 mb-0 md:text-base text-xs">Data Exploration</h3>
            <p className="text-xs md:text-sm text-muted-foreground md:block hidden">
              Query and analyze data from databases, CSV files, or custom sources
            </p>
          </div>

          <div className="bg-chat-assistant rounded-lg md:p-6 p-2 hover:bg-chat-hover transition-colors">
            <Sparkles className="md:h-8 md:w-8 h-5 w-5 text-primary md:mb-3 mb-1 mx-auto" />
            <h3 className="font-semibold md:mb-2 mb-0 md:text-base text-xs">AI-Powered Insights</h3>
            <p className="text-xs md:text-sm text-muted-foreground md:block hidden">
              Get intelligent recommendations and actionable insights from your data
            </p>
          </div>
        </div>

        <div className="md:pt-6 pt-2">
          <p className="text-xs md:text-sm text-muted-foreground">
            Start by selecting your data source above, or type a question to begin analyzing
          </p>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;

