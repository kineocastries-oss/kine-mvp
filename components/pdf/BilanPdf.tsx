import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Section } from "@/lib/bilan/normalize";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 18, marginBottom: 12 },
  sectionTitle: { fontSize: 13, marginTop: 12, marginBottom: 6 },
  line: { marginBottom: 4 },
  label: { fontWeight: "bold" },
  hr: { marginTop: 6, marginBottom: 6, height: 1, backgroundColor: "#e5e7eb" },
});

export default function BilanPdf({ sections }: { sections: Section[] }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Bilan kinésithérapique</Text>

        {sections.map((s, idx) => (
          <View key={idx}>
            <Text style={styles.sectionTitle}>{`${idx + 1}. ${s.title}`}</Text>
            <View style={styles.hr} />
            {s.lines.map((ln, i) => (
              <Text key={i} style={styles.line}>
                <Text style={styles.label}>{ln.label} : </Text>
                <Text>{ln.value}</Text>
              </Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
