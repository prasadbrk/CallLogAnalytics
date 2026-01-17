import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, ScrollView, TouchableOpacity, 
  ActivityIndicator, Platform, PermissionsAndroid, Alert, TextInput, Share, Linking, AppState, RefreshControl, Modal, KeyboardAvoidingView, Keyboard
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { 
  Phone, Clock, TrendingUp, Users, Calendar, 
  UserCheck, UserX, AlertCircle, Search, Share2, PhoneCall, Grip, Delete, Sparkles, Send, X
} from 'lucide-react-native';
import * as Contacts from 'expo-contacts';
import { GoogleGenerativeAI } from "@google/generative-ai";

// ==========================================
// 🔑 CONFIGURATION: PASTE YOUR API KEY HERE
// ==========================================
const GEMINI_API_KEY = "AIzaSyCJUAVpZmrJLgdmIZQyhGUB1AZ-lZ5ZUPw"; 
// ^^^ Go to https://aistudio.google.com/ to get a free key

// --- ROBUST IMPORT: Load CallLogs library ---
let CallLogs = null;
if (Platform.OS !== 'web') {
  try {
    const pkg = require('react-native-call-log');
    CallLogs = pkg.default || pkg; 
  } catch (e) {
    console.warn("Library import failed:", e);
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [masterData, setMasterData] = useState(null);
  const [activeTab, setActiveTab] = useState('saved'); 
  const [searchQuery, setSearchQuery] = useState(''); 
  
  // --- UI STATES ---
  const [dialPadVisible, setDialPadVisible] = useState(false);
  const [dialNumber, setDialNumber] = useState('');
  
  // --- AI STATES ---
  const [aiVisible, setAiVisible] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const appState = useRef(AppState.currentState);

  useEffect(() => {
    requestPermissions();
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        loadData(false);
      }
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        ]);
        if (
          granted['android.permission.READ_CALL_LOG'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.READ_CONTACTS'] === PermissionsAndroid.RESULTS.GRANTED
        ) {
          loadData(true);
        } else {
          Alert.alert("Permissions Missing", "Please allow Call Logs & Contacts.");
          setLoading(false);
        }
      } catch (err) {
        Alert.alert("Error", err.message);
        setLoading(false);
      }
    } else {
        setLoading(false);
    }
  };

  const normalizeNumber = (num) => {
    if (!num) return '';
    let clean = num.replace(/\D/g, '');
    if (clean.length > 10 && clean.startsWith('91')) clean = clean.substring(2);
    if (clean.startsWith('0')) clean = clean.substring(1);
    return clean;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "0s";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const makeCall = (number) => {
    let phoneNumber = `tel:${number}`;
    Linking.openURL(phoneNumber);
  };

  // --- AI LOGIC ---
  const askGemini = async () => {
    if (!aiQuery.trim()) return;
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("PASTE_YOUR")) {
        Alert.alert("API Key Missing", "Please add your Gemini API Key in the code.");
        return;
    }

    setAiLoading(true);
    setAiResponse('');
    Keyboard.dismiss();

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Prepare context (Limit data to prevent token overflow)
        // We send Stats + Top 50 contacts to the AI
        const contextData = {
            saved_stats: masterData.saved.stats,
            unknown_stats: masterData.unknown.stats,
            top_saved_contacts: masterData.saved.listByCount.slice(0, 50).map(c => ({n: c.name, num: c.phoneNumber, calls: c.count, dur: c.duration})),
            top_unknown_numbers: masterData.unknown.listByCount.slice(0, 20).map(c => ({num: c.phoneNumber, calls: c.count})),
            activity_heatmap: masterData.saved.hourly
        };

        const prompt = `
        You are an intelligent Call Analytics Assistant. 
        Here is the user's call log summary in JSON format: 
        ${JSON.stringify(contextData)}
        
        User Question: "${aiQuery}"
        
        Answer based ONLY on the data provided. Be concise, professional, and friendly. 
        If asked about a specific person, check the 'top_saved_contacts' list. 
        Duration is in seconds. Convert to minutes/hours for the user.
        `;

        const result = await model.generateContent(prompt);
        const response = result.response;
        setAiResponse(response.text());

    } catch (error) {
        setAiResponse("Error: " + error.message);
    } finally {
        setAiLoading(false);
    }
  };

  // --- DIALPAD LOGIC ---
  const handleDialPadPress = (digit) => setDialNumber(prev => prev + digit);
  const handleBackspace = () => setDialNumber(prev => prev.slice(0, -1));

  const exportData = async () => {
    if (!masterData) return;
    const dataToExport = activeTab === 'saved' ? masterData.saved.listByCount : masterData.unknown.listByCount;
    let csvString = "Rank,Name,Number,Count,Duration(s)\n";
    dataToExport.forEach((item, index) => {
        csvString += `${index+1},${item.name},${item.phoneNumber},${item.count},${item.duration}\n`;
    });
    try {
      await Share.share({ message: csvString, title: 'Call Analytics Export' });
    } catch (error) {
      Alert.alert(error.message);
    }
  };

  const loadData = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      const contactMap = {};
      data.forEach(c => {
        if (c.phoneNumbers) {
          c.phoneNumbers.forEach(p => {
            contactMap[normalizeNumber(p.number)] = c.name;
          });
        }
      });

      if (!CallLogs) {
          setLoading(false);
          setRefreshing(false);
          return;
      }
      const rawLogs = await CallLogs.loadAll();
      
      let savedItems = {};
      let unknownItems = {};
      let savedHourly = Array(24).fill(0);
      let unknownHourly = Array(24).fill(0);

      rawLogs.forEach(log => {
        const cleanNum = normalizeNumber(log.phoneNumber);
        const isSaved = !!contactMap[cleanNum];
        const name = contactMap[cleanNum] || log.name || log.phoneNumber;
        const dur = parseInt(log.duration) || 0;
        const timestamp = parseInt(log.timestamp);
        const hour = new Date(timestamp).getHours();

        const targetMap = isSaved ? savedItems : unknownItems;
        const targetHourly = isSaved ? savedHourly : unknownHourly;
        if(hour >= 0 && hour < 24) targetHourly[hour]++;

        if (!targetMap[cleanNum]) {
            targetMap[cleanNum] = {
                name: name, phoneNumber: log.phoneNumber, count: 0, duration: 0,
                incoming: 0, outgoing: 0, missed: 0, isSaved: isSaved
            };
        }
        const item = targetMap[cleanNum];
        item.count++;
        item.duration += dur;
        if (log.type === 'MISSED' || log.type === 3) item.missed++;
      });

      const processList = (itemMap, hourlyData) => {
          const list = Object.values(itemMap);
          const stats = list.reduce((acc, item) => ({
              total: acc.total + item.count,
              duration: acc.duration + item.duration,
              missed: acc.missed + item.missed
          }), { total:0, duration:0, missed:0 });
          return {
              stats, hourly: hourlyData,
              listByCount: [...list].sort((a,b) => b.count - a.count),
              listByDuration: [...list].sort((a,b) => b.duration - a.duration),
              topTalker: [...list].sort((a,b) => b.duration - a.duration)[0] || {name: 'N/A', duration: 0},
          };
      };
      setMasterData({ saved: processList(savedItems, savedHourly), unknown: processList(unknownItems, unknownHourly) });
      setLoading(false);
      setRefreshing(false);
    } catch (e) {
      setLoading(false);
      setRefreshing(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#2563EB" /></View>;
  if (!masterData) return <View style={styles.center}><TouchableOpacity onPress={requestPermissions}><Text>Retry</Text></TouchableOpacity></View>;

  const currentData = activeTab === 'saved' ? masterData.saved : masterData.unknown;
  const themeColor = activeTab === 'saved' ? '#16A34A' : '#F97316'; 
  const themeLight = activeTab === 'saved' ? '#DCFCE7' : '#FFEDD5';

  const isSearching = searchQuery.length > 0;
  const searchResults = isSearching 
    ? currentData.listByCount.filter(item => 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        item.phoneNumber.includes(searchQuery)
      )
    : [];

  return (
    <View style={styles.container}>
      
      {/* HEADER */}
      <View style={styles.headerContainer}>
        <LinearGradient 
          colors={activeTab === 'saved' ? ['#166534', '#15803d'] : ['#c2410c', '#ea580c']} 
          style={styles.headerGradient}
        >
          <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom: 15}}>
             <Text style={styles.headerTitle}>Dashboard</Text>
             <View style={{flexDirection: 'row', gap: 10}}>
                <TouchableOpacity onPress={() => setAiVisible(true)} style={styles.iconBtn}>
                    <Sparkles color="#FDBA74" size={20} />
                </TouchableOpacity>
                <TouchableOpacity onPress={exportData} style={styles.iconBtn}>
                    <Share2 color="white" size={20} />
                </TouchableOpacity>
             </View>
          </View>

          <View style={styles.searchContainer}>
             <Search size={20} color={activeTab === 'saved' ? '#166534' : '#c2410c'} />
             <TextInput 
                style={styles.searchInput}
                placeholder="Search name or number..."
                placeholderTextColor="#999"
                value={searchQuery}
                onChangeText={setSearchQuery}
             />
             {isSearching && (
                 <TouchableOpacity onPress={() => setSearchQuery('')}>
                     <UserX size={18} color="#999" />
                 </TouchableOpacity>
             )}
          </View>
          
          <View style={styles.toggleContainer}>
            <TouchableOpacity onPress={() => setActiveTab('saved')} style={[styles.toggleBtn, activeTab === 'saved' && styles.toggleBtnActive]}>
                <UserCheck size={16} color={activeTab === 'saved' ? '#166534' : '#fff'} />
                <Text style={[styles.toggleText, activeTab === 'saved' && {color: '#166534'}]}> Saved Contacts</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveTab('unknown')} style={[styles.toggleBtn, activeTab === 'unknown' && styles.toggleBtnActive]}>
                <UserX size={16} color={activeTab === 'unknown' ? '#c2410c' : '#fff'} />
                <Text style={[styles.toggleText, activeTab === 'unknown' && {color: '#c2410c'}]}> Unknown Numbers</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* CONTENT */}
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {setRefreshing(true); loadData(false);}} colors={[themeColor]} />}
      >
        {isSearching ? (
             <View style={styles.tableCard}>
                <View style={[styles.tableHeader, {borderLeftColor: themeColor}]}>
                    <Text style={styles.tableTitle}>Search Results ({searchResults.length})</Text>
                </View>
                {searchResults.slice(0, 50).map((item, i) => (
                    <ListItem key={i} item={item} rank={i+1} highlight="count" theme={themeColor} onCall={() => makeCall(item.phoneNumber)} themeLight={themeLight} />
                ))}
             </View>
        ) : (
        <>
            <View style={styles.summaryRow}>
                <SummaryCard label="Total Calls" value={currentData.stats.total} icon={Phone} color={themeColor} />
                <SummaryCard label="Duration" value={formatDuration(currentData.stats.duration)} icon={Clock} color={themeColor} />
                <SummaryCard label="Missed" value={currentData.stats.missed} icon={AlertCircle} color="#DC2626" />
            </View>

            <View style={styles.sectionHeader}>
                <TrendingUp size={18} color="#475569" />
                <Text style={styles.sectionTitle}>Key Insights</Text>
            </View>
            <View style={styles.insightGrid}>
                <InsightCard 
                    title={activeTab === 'saved' ? "Top Talker" : "Frequent Caller"}
                    value={currentData.topTalker?.name || "N/A"}
                    subValue={activeTab === 'saved' 
                        ? `${formatDuration(currentData.topTalker?.duration)} spoke` 
                        : `${currentData.topTalker?.count || 0} calls received`}
                    icon={UserCheck}
                    bg={themeLight}
                    accent={themeColor}
                />
                <InsightCard 
                    title="Avg Call Length"
                    value={formatDuration(currentData.stats.total ? currentData.stats.duration / currentData.stats.total : 0)}
                    subValue="per conversation"
                    icon={Clock}
                    bg="#F1F5F9"
                    accent="#475569"
                />
            </View>

            <View style={styles.chartCard}>
                <View style={{flexDirection:'row', alignItems:'center', marginBottom:15}}>
                    <Calendar size={18} color="#475569" />
                    <Text style={[styles.sectionTitle, {marginLeft:8, marginBottom:0}]}>Activity Heatmap (24h)</Text>
                </View>
                <View style={styles.chartContainer}>
                    {currentData.hourly.map((val, i) => {
                        const max = Math.max(...currentData.hourly, 1);
                        const height = max > 0 ? (val / max) * 100 : 0;
                        return (
                        <View key={i} style={styles.barWrapper}>
                            <View style={[styles.bar, {height: `${height}%`, backgroundColor: themeColor}]} />
                            <Text style={[styles.barLabel, { marginTop: i % 2 === 0 ? 2 : 14 }]}>
                                {i}
                            </Text>
                        </View>
                        )
                    })}
                </View>
            </View>

            <View style={styles.tableCard}>
                <View style={[styles.tableHeader, {borderLeftColor: themeColor}]}>
                    <Text style={styles.tableTitle}>Top 100 by Frequency</Text>
                </View>
                <ScrollView style={{height: 300}} nestedScrollEnabled>
                    {currentData.listByCount.slice(0, 100).map((item, i) => (
                        <ListItem key={i} item={item} rank={i+1} highlight="count" theme={themeColor} onCall={() => makeCall(item.phoneNumber)} themeLight={themeLight} />
                    ))}
                </ScrollView>
            </View>

            <View style={styles.tableCard}>
                <View style={[styles.tableHeader, {borderLeftColor: '#3B82F6'}]}>
                    <Text style={styles.tableTitle}>Top 100 by Duration</Text>
                </View>
                <ScrollView style={{height: 300}} nestedScrollEnabled>
                    {currentData.listByDuration.slice(0, 100).map((item, i) => (
                        <ListItem key={i} item={item} rank={i+1} highlight="duration" theme="#3B82F6" onCall={() => makeCall(item.phoneNumber)} themeLight={'#DBEAFE'} />
                    ))}
                </ScrollView>
            </View>
        </>
        )}
      </ScrollView>

      {/* --- AI ASSISTANT MODAL --- */}
      <Modal visible={aiVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAiVisible(false)}>
        <SafeAreaView style={{flex:1, backgroundColor: '#F8FAFC'}}>
            <View style={styles.aiHeader}>
                <Text style={styles.aiTitle}>AI Insights</Text>
                <TouchableOpacity onPress={() => setAiVisible(false)} style={styles.closeBtn}>
                    <X size={24} color="#64748B" />
                </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.aiContent} contentContainerStyle={{padding: 20}}>
                {aiResponse ? (
                    <View style={styles.aiResponseCard}>
                        <Sparkles size={20} color="#7C3AED" style={{marginBottom: 10}} />
                        <Text style={styles.aiText}>{aiResponse}</Text>
                    </View>
                ) : (
                    <View style={{alignItems:'center', marginTop: 50, opacity: 0.5}}>
                        <Sparkles size={48} color="#CBD5E1" />
                        <Text style={{marginTop: 10, color: '#64748B'}}>Ask about your call history...</Text>
                    </View>
                )}
                {aiLoading && <ActivityIndicator size="large" color="#7C3AED" style={{marginTop: 20}} />}
            </ScrollView>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.aiInputContainer}>
                <TextInput 
                    style={styles.aiInput} 
                    placeholder="Ex: Who do I talk to most?" 
                    value={aiQuery}
                    onChangeText={setAiQuery}
                />
                <TouchableOpacity style={styles.sendBtn} onPress={askGemini} disabled={aiLoading}>
                    <Send size={20} color="white" />
                </TouchableOpacity>
            </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* --- FLOATING DIALPAD BUTTON --- */}
      <TouchableOpacity 
         style={[styles.fab, {backgroundColor: themeColor}]} 
         onPress={() => setDialPadVisible(true)}
      >
         <Grip color="white" size={28} />
      </TouchableOpacity>

      {/* --- DIALPAD MODAL --- */}
      <Modal visible={dialPadVisible} animationType="slide" transparent={true} onRequestClose={() => setDialPadVisible(false)}>
        <View style={styles.modalOverlay}>
            <View style={styles.dialPadContainer}>
                <View style={styles.dialPadHeader}>
                    <TouchableOpacity onPress={() => setDialPadVisible(false)}>
                        <Text style={{color:'#666', fontSize: 16}}>Close</Text>
                    </TouchableOpacity>
                    <Text style={{fontWeight:'bold', fontSize: 16}}>Keypad</Text>
                    <View style={{width: 40}} /> 
                </View>
                <View style={styles.dialScreen}>
                    <Text style={styles.dialNumberText}>{dialNumber}</Text>
                    {dialNumber.length > 2 && (
                        <View style={styles.t9Preview}>
                           {(() => {
                               const match = [...masterData.saved.listByCount, ...masterData.unknown.listByCount]
                                .find(i => i.phoneNumber.includes(dialNumber));
                               return match ? <Text style={{color: themeColor}}>{match.name} ({match.phoneNumber})</Text> : <Text style={{color:'#999'}}>Unknown</Text>
                           })()}
                        </View>
                    )}
                </View>
                <View style={styles.dialGrid}>
                    {[
                        ['1',''], ['2','ABC'], ['3','DEF'],
                        ['4','GHI'], ['5','JKL'], ['6','MNO'],
                        ['7','PQRS'], ['8','TUV'], ['9','WXYZ'],
                        ['*',''], ['0','+'], ['#','']
                    ].map((btn, i) => (
                        <TouchableOpacity key={i} style={styles.dialBtn} onPress={() => handleDialPadPress(btn[0])}>
                            <Text style={styles.dialDigit}>{btn[0]}</Text>
                            <Text style={styles.dialLetters}>{btn[1]}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <View style={styles.dialActions}>
                    <View style={{width: 60}} /> 
                    <TouchableOpacity 
                        style={[styles.callActionBtn, {backgroundColor: '#22c55e'}]} 
                        onPress={() => dialNumber.length > 0 && makeCall(dialNumber)}
                    >
                        <PhoneCall color="white" size={32} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.backspaceBtn} onPress={handleBackspace} onLongPress={() => setDialNumber('')}>
                        <Delete color="#666" size={28} />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
      </Modal>

    </View>
  );
}

// Components
const SummaryCard = ({ label, value, icon: Icon, color }) => (
    <View style={styles.summaryCard}>
        <View style={[styles.iconCircle, {backgroundColor: color+'15'}]}>
            <Icon size={20} color={color} />
        </View>
        <View>
            <Text style={styles.summaryValue}>{value}</Text>
            <Text style={styles.summaryLabel}>{label}</Text>
        </View>
    </View>
);

const InsightCard = ({ title, value, subValue, icon: Icon, bg, accent }) => (
    <View style={[styles.insightCard, {backgroundColor: bg, borderColor: bg}]}>
        <View style={{flexDirection:'row', justifyContent:'space-between'}}>
            <Text style={[styles.insightTitle, {color: accent}]}>{title}</Text>
            <Icon size={16} color={accent} style={{opacity:0.7}} />
        </View>
        <Text style={styles.insightValue} numberOfLines={1}>{value}</Text>
        <Text style={styles.insightSub}>{subValue}</Text>
    </View>
);

const ListItem = ({ item, rank, highlight, theme, onCall, themeLight }) => (
    <View style={styles.row}>
        <TouchableOpacity onPress={onCall} style={[styles.callBtn, {backgroundColor: themeLight}]}>
             <PhoneCall size={16} color={theme} />
        </TouchableOpacity>
        <View style={{flex: 1, paddingHorizontal: 10}}>
            <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.rowSub}>{item.phoneNumber}</Text>
        </View>
        <View style={{width: 60, alignItems:'center'}}>
            <Text style={[styles.rowVal, highlight === 'count' && {color: theme, fontWeight:'bold'}]}>
                {item.count}
            </Text>
        </View>
        <View style={{width: 80, alignItems:'flex-end'}}>
             <Text style={[styles.rowVal, highlight === 'duration' && {color: theme, fontWeight:'bold'}]}>
                {Math.round(item.duration/60)}m
            </Text>
        </View>
    </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerContainer: { backgroundColor: 'white', marginBottom: 10, paddingBottom: 15 },
  headerGradient: { paddingTop: 50, paddingBottom: 25, paddingHorizontal: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: 'white' },
  iconBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 12, paddingHorizontal: 10, height: 45, marginBottom: 15 },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 16, color: '#333' },
  toggleContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 100, padding: 4 },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 100, gap: 6 },
  toggleBtnActive: { backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  toggleText: { color: 'white', fontWeight: '600', fontSize: 13 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: -30 },
  summaryCard: { flex: 1, backgroundColor: 'white', marginHorizontal: 4, padding: 12, borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3, alignItems: 'center', gap: 6 },
  iconCircle: { padding: 8, borderRadius: 50 },
  summaryValue: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  summaryLabel: { fontSize: 11, color: '#64748B', fontWeight: '500' },
  scrollContent: { paddingBottom: 100, paddingTop: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 25, marginBottom: 10, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#334155' },
  
  insightGrid: { flexDirection: 'row', paddingHorizontal: 16, gap: 10 },
  insightCard: { flex: 1, padding: 16, borderRadius: 16, borderWidth: 1 },
  insightTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  insightValue: { fontSize: 18, fontWeight: '800', color: '#1E293B', marginBottom: 2 },
  insightSub: { fontSize: 11, color: '#64748B' },

  tableCard: { backgroundColor: 'white', marginHorizontal: 16, marginTop: 15, borderRadius: 16, padding: 0, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 5, elevation: 2, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  tableHeader: { padding: 16, borderLeftWidth: 4, backgroundColor: '#F8FAFC' },
  tableTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  callBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowName: { fontSize: 13, fontWeight: '600', color: '#334155' },
  rowSub: { fontSize: 11, color: '#94A3B8' },
  rowVal: { fontSize: 13, color: '#64748B' },
  
  chartCard: { backgroundColor: 'white', margin: 16, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', height: 160 },
  chartContainer: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4 },
  barWrapper: { flex: 1, alignItems: 'center' },
  bar: { width: '100%', borderRadius: 2, minHeight: 4 },
  barLabel: { fontSize: 9, color: '#94A3B8', marginTop: 4, height: 12 }, 

  // DIAL PAD
  fab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOffset: {width:0, height:4}, shadowOpacity: 0.3, shadowRadius: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dialPadContainer: { backgroundColor: '#F8FAFC', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, height: '70%' },
  dialPadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  dialScreen: { alignItems: 'center', marginBottom: 20, height: 80, justifyContent: 'center' },
  dialNumberText: { fontSize: 32, fontWeight: 'bold', color: '#1E293B' },
  t9Preview: { marginTop: 5 },
  dialGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 20 },
  dialBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: 'white', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  dialDigit: { fontSize: 24, fontWeight: '600', color: '#1E293B' },
  dialLetters: { fontSize: 10, color: '#94A3B8', fontWeight: '700' },
  dialActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingHorizontal: 40 },
  callActionBtn: { width: 70, height: 70, borderRadius: 35, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  backspaceBtn: { width: 60, height: 60, justifyContent: 'center', alignItems: 'center' },

  // AI MODAL STYLES
  aiHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: 'white' },
  aiTitle: { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  aiContent: { flex: 1 },
  aiResponseCard: { backgroundColor: 'white', padding: 20, borderRadius: 16, marginVertical: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  aiText: { fontSize: 16, lineHeight: 24, color: '#334155' },
  aiInputContainer: { flexDirection: 'row', padding: 15, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: 'white', alignItems: 'center' },
  aiInput: { flex: 1, backgroundColor: '#F1F5F9', borderRadius: 24, paddingHorizontal: 20, paddingVertical: 12, marginRight: 10, fontSize: 16 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#7C3AED', justifyContent: 'center', alignItems: 'center' }
});