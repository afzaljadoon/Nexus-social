import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../context/TenantContext';
import { motion, AnimatePresence } from 'framer-motion';
import { FiFolder, FiFolderPlus, FiUpload, FiTrash2, FiDownload, FiChevronRight, FiEye, FiX, FiFile, FiImage, FiMusic, FiVideo, FiLoader, FiAlertCircle } from 'react-icons/fi';

interface WorkspaceFile {
  id: string;
  name: string;
  is_folder: boolean;
  parent_id: string | null;
  storage_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  created_by: string;
}

export default function FileManager() {
  const { user } = useAuth();
  const { activeWorkspace } = useTenant();

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'Root' }]);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Folder creation state
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderForm, setShowFolderForm] = useState(false);

  // File Preview state
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Fetch file list
  const fetchFiles = async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      let query = supabase
        .from('workspace_files')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('is_folder', { ascending: false })
        .order('name', { ascending: true });

      if (currentFolderId) {
        query = query.eq('parent_id', currentFolderId);
      } else {
        query = query.is('parent_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      setFiles(data || []);
    } catch (err) {
      console.error('Error fetching files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [activeWorkspace, currentFolderId]);

  // Handle Breadcrumb click
  const handleBreadcrumbClick = (folderId: string | null, index: number) => {
    setCurrentFolderId(folderId);
    setBreadcrumbs(breadcrumbs.slice(0, index + 1));
  };

  // Open a Folder
  const handleOpenFolder = (folder: WorkspaceFile) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs([...breadcrumbs, { id: folder.id, name: folder.name }]);
  };

  // Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace || !user || !newFolderName.trim()) return;

    try {
      setErrorMsg('');
      const { error } = await supabase
        .from('workspace_files')
        .insert([{
          workspace_id: activeWorkspace.id,
          name: newFolderName.trim(),
          is_folder: true,
          parent_id: currentFolderId,
          created_by: user.id
        }]);

      if (error) throw error;
      setNewFolderName('');
      setShowFolderForm(false);
      fetchFiles();
    } catch (err: any) {
      console.error('Folder creation error:', err);
      setErrorMsg(err.message || 'Failed to create folder.');
    }
  };

  // Handle File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeWorkspace || !user) return;

    setUploading(true);
    setErrorMsg('');
    try {
      const fileId = crypto.randomUUID();
      const storagePath = `${activeWorkspace.id}/${fileId}`;

      // 1. Upload to Storage Bucket
      const { error: uploadError } = await supabase.storage
        .from('workspace-files')
        .upload(storagePath, file, { cacheControl: '3600', upsert: true });

      if (uploadError) throw uploadError;

      // 2. Insert metadata record
      const { error: dbError } = await supabase
        .from('workspace_files')
        .insert([{
          id: fileId,
          workspace_id: activeWorkspace.id,
          name: file.name,
          is_folder: false,
          parent_id: currentFolderId,
          storage_path: storagePath,
          file_size: file.size,
          mime_type: file.type,
          created_by: user.id
        }]);

      if (dbError) {
        // Rollback storage upload on metadata failure
        await supabase.storage.from('workspace-files').remove([storagePath]);
        throw dbError;
      }

      fetchFiles();
    } catch (err: any) {
      console.error('Upload error:', err);
      setErrorMsg(err.message || 'Failed to upload file. Check permissions.');
    } finally {
      setUploading(false);
    }
  };

  // Delete file or folder
  const handleDeleteItem = async (item: WorkspaceFile) => {
    if (!window.confirm(`Are you sure you want to delete "${item.name}"?`)) return;

    try {
      setErrorMsg('');
      
      // If file, clean up storage object first
      if (!item.is_folder && item.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('workspace-files')
          .remove([item.storage_path]);
        if (storageError) throw storageError;
      }

      // Delete database record (cascades sub-items if folder)
      const { error: dbError } = await supabase
        .from('workspace_files')
        .delete()
        .eq('id', item.id);

      if (dbError) throw dbError;
      fetchFiles();
    } catch (err: any) {
      console.error('Delete error:', err);
      setErrorMsg(err.message || 'Failed to delete item.');
    }
  };

  // Generate signed URL and show preview panel
  const handlePreviewFile = async (file: WorkspaceFile) => {
    if (!file.storage_path) return;
    setPreviewFile(file);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const { data, error } = await supabase.storage
        .from('workspace-files')
        .createSignedUrl(file.storage_path, 300); // 5 min access token

      if (error) throw error;
      setPreviewUrl(data.signedUrl);
    } catch (err) {
      console.error('Error generating preview link:', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  // File type icon helpers
  const getFileIcon = (file: WorkspaceFile) => {
    if (file.is_folder) return <FiFolder color="#f59e0b" size={20} />;
    
    const type = file.mime_type || '';
    if (type.startsWith('image/')) return <FiImage color="#06b6d4" size={20} />;
    if (type.startsWith('audio/')) return <FiMusic color="#a855f7" size={20} />;
    if (type.startsWith('video/')) return <FiVideo color="#ef4444" size={20} />;
    return <FiFile color="#94a3b8" size={20} />;
  };

  // File size formatter
  const formatSize = (bytes: number | null) => {
    if (bytes === null) return '';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '480px', textAlign: 'left', marginTop: '24px', position: 'relative' }}>
      
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px' }}>
        <div style={{ minWidth: '160px', flex: '1 1 auto' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
            <FiFolder color="var(--color-secondary)" />
            <span>Workspace Cloud Storage</span>
          </h3>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0 0', lineHeight: '1.3' }}>
            Enterprise document storage, sharing, and secure access checks
          </p>
        </div>

        <button
          onClick={() => setShowFolderForm(!showFolderForm)}
          className="btn btn-secondary"
          style={{ padding: '6px 10px', borderRadius: '8px', fontSize: '0.75rem', height: '32px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: '0 auto 0 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <FiFolderPlus />
          <span>New Folder</span>
        </button>

        <label
          className="btn btn-secondary"
          style={{ padding: '6px 10px', borderRadius: '8px', fontSize: '0.75rem', height: '32px', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {uploading ? <FiLoader className="spin" size={12} /> : <FiUpload />}
          <span>Upload File</span>
          <input type="file" onChange={handleFileUpload} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>

      {errorMsg && (
        <div className="error-alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.8rem' }}>
          <FiAlertCircle size={14} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Folder Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={crumb.id || 'root'}>
            {idx > 0 && <FiChevronRight size={12} />}
            <button
              onClick={() => handleBreadcrumbClick(crumb.id, idx)}
              style={{
                background: 'none',
                border: 'none',
                color: idx === breadcrumbs.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: idx === breadcrumbs.length - 1 ? 600 : 500,
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              {crumb.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Folder Creator Overlay Form */}
      <AnimatePresence>
        {showFolderForm && (
          <motion.form
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onSubmit={handleCreateFolder}
            style={{ display: 'flex', gap: '8px', marginBottom: '16px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px dashed var(--surface-border)' }}
          >
            <input
              type="text"
              placeholder="Folder Name (e.g. Design Assets)"
              className="input-field"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              required
              style={{ flex: 1, height: '36px', borderRadius: '6px', fontSize: '0.85rem' }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '0 16px', height: '36px', borderRadius: '6px', fontSize: '0.85rem' }}>
              Create
            </button>
            <button type="button" onClick={() => setShowFolderForm(false)} className="btn btn-secondary" style={{ padding: '0 12px', height: '36px', borderRadius: '6px', fontSize: '0.85rem' }}>
              Cancel
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Explorer Grid */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '150px' }}>
            <FiLoader className="spin" size={24} color="var(--color-secondary)" />
          </div>
        ) : files.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)', gap: '8px' }}>
            <FiFolder size={32} />
            <span style={{ fontSize: '0.8rem' }}>Folder is empty. Upload files to get started!</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '12px', padding: '4px' }}>
            {files.map((file) => (
              <div
                key={file.id}
                onDoubleClick={() => file.is_folder && handleOpenFolder(file)}
                style={{
                  padding: '12px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  position: 'relative',
                  textAlign: 'center',
                  transition: 'all 0.2s',
                  userSelect: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                  e.currentTarget.style.borderColor = 'var(--surface-border)';
                }}
              >
                {/* File Icon */}
                <div style={{ margin: '8px 0' }}>
                  {getFileIcon(file)}
                </div>

                {/* File Name */}
                <span style={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  width: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--text-primary)',
                  display: 'block'
                }}>
                  {file.name}
                </span>

                {/* Subtext (size or folder label) */}
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {file.is_folder ? 'Folder' : formatSize(file.file_size)}
                </span>

                {/* Quick actions overlay */}
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                  {!file.is_folder && (
                    <button
                      onClick={() => handlePreviewFile(file)}
                      title="Preview"
                      style={{ background: 'rgba(255,255,255,0.04)', border: 'none', color: 'var(--text-primary)', width: '22px', height: '22px', borderRadius: '4px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <FiEye size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteItem(file)}
                    title="Delete"
                    style={{ background: 'rgba(239,68,68,0.08)', border: 'none', color: '#ef4444', width: '22px', height: '22px', borderRadius: '4px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <FiTrash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* File Preview Drawer Overlay */}
      <AnimatePresence>
        {previewFile && (
          <>
            {/* Backdrop */}
            <div 
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 120, borderRadius: '24px' }} 
              onClick={() => setPreviewFile(null)} 
            />
            {/* Preview Sheet */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: '320px',
                height: '100%',
                background: 'rgba(10, 15, 30, 0.96)',
                backdropFilter: 'blur(16px)',
                borderLeft: '1px solid rgba(6, 182, 212, 0.25)',
                borderRadius: '0 24px 24px 0',
                padding: '24px',
                zIndex: 121,
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                  {previewFile.name}
                </span>
                <button onClick={() => setPreviewFile(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <FiX size={18} />
                </button>
              </div>

              {/* Preview Content */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--surface-border)', overflow: 'hidden', minHeight: '180px' }}>
                {previewLoading ? (
                  <FiLoader className="spin" size={24} color="var(--color-secondary)" />
                ) : previewUrl ? (
                  previewFile.mime_type?.startsWith('image/') ? (
                    <img src={previewUrl} alt={previewFile.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  ) : previewFile.mime_type?.startsWith('video/') ? (
                    <video src={previewUrl} controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
                  ) : previewFile.mime_type?.startsWith('audio/') ? (
                    <audio src={previewUrl} controls style={{ width: '90%' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                      <FiFile size={42} />
                      <span style={{ fontSize: '0.75rem' }}>Preview not available</span>
                    </div>
                  )
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Failed to load preview</span>
                )}
              </div>

              {/* Info panel */}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.01)', padding: '12px', borderRadius: '8px' }}>
                <span><strong>Size:</strong> {formatSize(previewFile.file_size)}</span>
                <span><strong>Type:</strong> {previewFile.mime_type || 'Unknown'}</span>
                <span><strong>Uploaded:</strong> {new Date(previewFile.created_at).toLocaleString()}</span>
              </div>

              {/* Actions */}
              {previewUrl && (
                <a
                  href={previewUrl}
                  download={previewFile.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ textDecoration: 'none', height: '36px', borderRadius: '8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifySelf: 'flex-end', gap: '6px' }}
                >
                  <FiDownload />
                  <span>Download File</span>
                </a>
              )}

            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
