import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Save, X } from "lucide-react";
import { generatePrefixedId } from "@/lib/idGenerator";

interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  queries: string[];
  createdAt: number;
}

interface CustomTemplateManagerProps {
  onClose: () => void;
  onSelectTemplate: (queries: string[]) => void;
}

const STORAGE_KEY = 'custom-analysis-templates';

export function CustomTemplateManager({ onClose, onSelectTemplate }: CustomTemplateManagerProps) {
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    queries: ['']
  });

  // Load templates from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setTemplates(JSON.parse(saved));
      } catch (error) {
        console.error('Error loading templates:', error);
      }
    }
  }, []);

  // Save templates to localStorage
  const saveTemplates = (newTemplates: CustomTemplate[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newTemplates));
    setTemplates(newTemplates);
  };

  const handleCreate = () => {
    if (!formData.name.trim() || formData.queries.filter(q => q.trim()).length === 0) {
      alert('Please provide a name and at least one query');
      return;
    }

    const newTemplate: CustomTemplate = {
      id: generatePrefixedId('template'),
      name: formData.name.trim(),
      description: formData.description.trim(),
      queries: formData.queries.filter(q => q.trim()),
      createdAt: Date.now()
    };

    saveTemplates([...templates, newTemplate]);
    setIsCreating(false);
    setFormData({ name: '', description: '', queries: [''] });
  };

  const handleUpdate = () => {
    if (!editingId || !formData.name.trim() || formData.queries.filter(q => q.trim()).length === 0) {
      alert('Please provide a name and at least one query');
      return;
    }

    const updated = templates.map(t => 
      t.id === editingId 
        ? { ...t, name: formData.name.trim(), description: formData.description.trim(), queries: formData.queries.filter(q => q.trim()) }
        : t
    );

    saveTemplates(updated);
    setEditingId(null);
    setFormData({ name: '', description: '', queries: [''] });
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      saveTemplates(templates.filter(t => t.id !== id));
    }
  };

  const handleEdit = (template: CustomTemplate) => {
    setEditingId(template.id);
    setFormData({
      name: template.name,
      description: template.description,
      queries: [...template.queries]
    });
    setIsCreating(false);
  };

  const addQuery = () => {
    setFormData(prev => ({ ...prev, queries: [...prev.queries, ''] }));
  };

  const updateQuery = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      queries: prev.queries.map((q, i) => i === index ? value : q)
    }));
  };

  const removeQuery = (index: number) => {
    setFormData(prev => ({
      ...prev,
      queries: prev.queries.filter((_, i) => i !== index)
    }));
  };

  const cancelEdit = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormData({ name: '', description: '', queries: [''] });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Custom Analysis Templates</h2>
            <p className="text-sm text-muted-foreground mt-1">Create your own reusable analysis workflows</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-accent rounded transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Create/Edit Form */}
          {(isCreating || editingId) && (
            <div className="bg-accent/30 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                {editingId ? 'Edit Template' : 'Create New Template'}
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Template Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Sales Analysis"
                    className="w-full px-3 py-2 bg-background border border-border rounded text-foreground"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of what this template does"
                    className="w-full px-3 py-2 bg-background border border-border rounded text-foreground"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Queries * (will run in order)
                  </label>
                  {formData.queries.map((query, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <textarea
                        value={query}
                        onChange={(e) => updateQuery(index, e.target.value)}
                        placeholder={`Query ${index + 1}`}
                        rows={2}
                        className="flex-1 px-3 py-2 bg-background border border-border rounded text-foreground resize-none"
                      />
                      {formData.queries.length > 1 && (
                        <button
                          onClick={() => removeQuery(index)}
                          className="p-2 hover:bg-accent rounded"
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addQuery}
                    className="mt-2 px-3 py-1 text-sm bg-accent hover:bg-accent/70 text-foreground rounded"
                  >
                    + Add Query
                  </button>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={editingId ? handleUpdate : handleCreate}
                    className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {editingId ? 'Update' : 'Create'} Template
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-4 py-2 bg-accent hover:bg-accent/70 text-foreground rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* New Template Button */}
          {!isCreating && !editingId && (
            <button
              onClick={() => setIsCreating(true)}
              className="w-full mb-6 py-3 border-2 border-dashed border-border hover:border-primary rounded-lg text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create New Template
            </button>
          )}

          {/* Templates List */}
          {templates.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No custom templates yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                Create your first template to get started!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="bg-accent/20 rounded-lg p-4 border border-border hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-foreground">{template.name}</h4>
                      {template.description && (
                        <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {template.queries.length} queries • Created {/* eslint-disable next-line @typescript-eslint/no-unused-vars */}{(() => {
                          const { formatDateOnly } = require('@/lib/dateFormatter');
                          return formatDateOnly(template.createdAt);
                        })()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(template)}
                        className="p-2 hover:bg-accent rounded"
                        title="Edit template"
                      >
                        <Edit2 className="w-4 h-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        className="p-2 hover:bg-accent rounded"
                        title="Delete template"
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View Queries
                      </summary>
                      <ul className="mt-2 space-y-1 ml-4">
                        {template.queries.map((query, idx) => (
                          <li key={idx} className="text-muted-foreground">
                            {idx + 1}. {query}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>

                  <button
                    onClick={() => {
                      onSelectTemplate(template.queries);
                      onClose();
                    }}
                    className="mt-3 w-full px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded"
                  >
                    Run Template
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
